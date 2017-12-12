

const KH = require('kinesis-handler') // eslint-disable-line import/no-unresolved
const WF = require('workfront-subscriptions')
const communicator = require('./lib/communicator')

const constants = {
  // self
  MODULE: 'storeEvent/eventConsumer.js',
  NONE: 'NONE',
  // Workfront
  APIKEY: process.env.API_KEY,
  FIELDS: process.env.FORM_FIELDS.split('|'),
  CATEGORY_ID: process.env.CATEGORY_ID,
  MESSAGE: {
    REMOVE: 'Do not remove the custom form from the Issue.  Use the menu to Delete the Issue: ',
    SWITCH: 'To switch the custom form for the Issue, use the menu first to Delete the existing Issue, then create a New Issue for: ',
    STORES: 'Recently entered List of Stores was not a string, and changes were not processed to Store Events.  Please correct and re-submit.', // TODO message may change or be unnecessary, depending on form
    DATES: 'Recently entered Dates were inconsistent, and changes were not processed to Store Events.  Please correct and re-submit.', // TODO message may change or be unnecessary, depending on form
    GOOD: 'Theoretically, event has been written successfully, though this has not yet been implemented.', // TODO update this message.
    BAD: 'An error occurred while attempting an update of Store Events with your changes.  Contact the Store team, citing this issue number: ',
  },
}

const temp = process.env.EVENT_TYPES.split('|')
const pairs = temp.map(x => `${process.env.OBJ_CODE}-${x}`)
const wf = WF(process.env.API_KEY, process.env.API_ENDPOINT, pairs.join('|'))
const eventSchema = wf.getStreamSchema()

/**
 * Transform record (which will be of the form in ingress schema) to the form of egress schema
 */
const transformer = (payload, record) => {
  const result = Object.assign({}, payload)
  result.schema = 'com.nordstrom/workfront/stream-egress/1-0-0'
  result.eventId = record.eventID
  result.timeIngest = new Date(record.kinesis.approximateArrivalTimestamp * 1000).toISOString()
  result.timeProcess = new Date().toISOString()
  return result
}

const kh = new KH.KinesisSynchronousHandler(eventSchema, constants.MODULE, transformer)

// TODO If we don't want to mess about with the schemas here, we need to provide one of each in the workfront-subscriptions.
const issueSchema = wf.getPayloadSchema(process.env.OBJ_CODE)
const createHeader = Object.assign({}, issueSchema.self)
createHeader.name = `${createHeader.name}/CREATE/${constants.CATEGORY_ID}`
const createSchema = Object.assign({}, issueSchema)
createSchema.self = createHeader
const deleteHeader = Object.assign({}, issueSchema.self)
deleteHeader.name = `${deleteHeader.name}/DELETE/${constants.CATEGORY_ID}`
const deleteSchema = Object.assign({}, issueSchema) // Can't filter with current WF functionality for DELETEs.
deleteSchema.self = deleteHeader
const updateIssueSchema = wf.getUpdatePayloadSchema(process.env.OBJ_CODE, 'UPDATE')
const updateHeader = Object.assign({}, updateIssueSchema.self)
updateHeader.name = `${updateHeader.name}/${constants.CATEGORY_ID}`
const updateSchema = Object.assign({}, updateIssueSchema)
updateSchema.self = updateHeader

/**
 * Example event:
   {
       "schema": "com.nordstrom/workfront/stream-ingress/1-0-0",
       "origin": "workfront/OPTASK/CREATE/599dabf700504b54e8db78f508611b55",
       "timeOrigin": "2017-02-28T23:29:20.171Z",
       "data" : {
          "schema": "com.nordstrom/workfront/OPTASK/CREATE/599dabf700504b54e8db78f508611b55/1-0-0",
          "ID":"59d671ae00600afe20334b6936cd785c",
          "name":"Lauren Testing Migration of EIM Event ID 44444",
          "objCode":"OPTASK",
          "ownerID":"598cea3d008a5fc75ea00c1166e6d743",
          "categoryID":"599dabf700504b54e8db78f508611b55",
          "status":"AWF",
          "referenceNumber":2905292,
          "teamID":null,
          "entryDate":"2017-10-05T11:53:00.000-0600",
          "lastUpdateDate":"2017-10-30T17:31:32.827-0600",
          "projectID":"599db3ec00552b4b5a7e9216d1585a83",
          "description":null,
          "priority":2,
          "enteredByID":"52f92b920019551e5c5741ab72a5d7c6",
          "assignedToID":"598cea3d008a5fc75ea00c1166e6d743",
          "lastUpdatedByID":"598cea3d008a5fc75ea00c1166e6d743",
          "customerID":"52f4f3ec006c9422d5e9bca0c2df4cd1",
          "accessorIDs":[
             "52f92b920019551e5c5741ab72a5d7c6",
             "5989fbd000bc83c84c24044244d6acd5",
             "598cea3d008a5fc75ea00c1166e6d743"
          ],
          "parameterValues":{
             "DE:In-Store Event Name":"Milliways Shoe Event with RSVP",
             "DE:RSVP?":"Required",
             "DE:Store Department":"Salon Shoes",
             "DE:List of Stores":"042",
             "DE:Event End":"2017-10-28 11:45:00",
             "DE:Store Event Description":"Another shoe event, for the time-deprived",
             "DE:Event Start":"2017-10-26 10:00:00",
             "DE:System comments":null
          }
       },
       "eventId":"shardId-000000000002:49571669009522853278119462494300940056686602130905104418",
       "timeIngest":"2017-02-28T23:29:23.262Z",
       "timeProcess":"2017-02-28T23:29:29.720Z"
     }
 */
const impl = {
  /**
   * Validates stores (as necessary) and returns the list of stores as a comma-separated string
   */
  makeAndCheckListOfStores: form => ({
    isValid: form['DE:List of Stores'] && typeof form['DE:List of Stores'] === 'string', // TODO implement as needed, using Store API endpoint, maybe with cache of stores
    multi: form['DE:List of Stores'] ? form['DE:List of Stores'].replace(/\s/g, '') : null, // TODO may need to assemble this rather than just harvest a list
  }),

  /**
   * Validates startDate < endDate and today's date <= endDate's date and returns the start and end dates in the format required by Store Events.
   */
  makeAndCheckDates: (form) => {
    const now = new Date()
    // Side note, in browser, to get dd/mm/yyyy: date = now.toLocaleDateString('en-GB', { timeZone: 'America/Los_Angeles' }).
    // In the browser, en-GB generates date as dd/mm/yyyy, whereas en-US does not include 0 before single digits.
    // Only in the browser.  Note extra efforts below to make it work in node.
    const dateTime = now.toLocaleTimeString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone: 'America/Los_Angeles', // NB AWS ecosystem will default to UTC, so need to set TZ for Seattle HQ
    }).split(', ')
    const date = dateTime[0].split('/') // in mm/dd/yyyy (no matter which format you ask for, you get US-style).
    // const time = dateTime[1] // in hh:mm:ss and 24hr time
    const today = `${date[2]}-${date[0]}-${date[1]}` // in Seattle

    // TODO create the date strings from dropdown fields for date
    const startDate = form['DE:Event Start']
    const endDate = form['DE:Event End']
    const end = endDate ? endDate.split(' ')[0] : null

    return {
      isValid: !startDate || !endDate || (today <= end && startDate < endDate), // TODO remove.  the nulls are to ignore checking new form versions
      startDate,
      endDate,
    }
  },

  extract: (form) => {
    const result = {}

    for (let i = 0; i < constants.FIELDS.length; i++) {
      if (form[`DE:${constants.FIELDS[i]}`]) {
        result[`DE:${constants.FIELDS[i]}`] = form[`DE:${constants.FIELDS[i]}`]
      }
    }

    return result
  },

  /**
   * Returns true if b matches a on the fields in a.  if exact is true, only returns true if they match each other field by field and have the same fields.
   * Works only on objects consisting only in fields with the following types: Boolean, Null, Undefined, Number, String.
   * Likely to fail on Objects and Arrays, unless they point to the same thing.
   * @param a
   * @param b
   * @param exact
   * @returns {boolean}
   */
  compareTwoObjectsWithPrimitiveFields: (a, b, exact) => {
    const keysA = Object.keys(a)
    const keysB = Object.keys(b)

    if (keysA.length > keysB.length || (exact && keysA.length < keysB.length)) return false

    for (let i = 0; i < keysA.length; i++) {
      const field = keysA[i]
      if (keysB.indexOf(field) === -1) {
        console.log('Failed to find: ', field)
        return false
      }
      if (b[field] !== a[field]) {
        console.log('Diff found: ', b[field], a[field])
        return false
      }
    }

    return true
  },

  /**
   * Sends a create event to the Store Events system for all items keyed by the Workfront id and the store number, for each store number in the List of Stores.
   *
   * NB Relies on the cleaning done by eventHandler of Workfront events before placing on stream so that CREATE events are truly CREATEs and
   * not just an update to a previously empty field, masquerading as a CREATE.
   *
   * @param event The event to create in Store Events (since it has been newly created from Workfront, with a new Workfront id).
   * @param complete The callback to inform of completion, with optional error parameter.
   */
  createHandler: (event, complete) => {
    console.log('Received a CREATE event.  Code not implemented.') // TODO remove
    setTimeout(() => complete(), 0) // TODO remove

    // TODO put together rest of store event
    // TODO ensure no empty strings on the fields where iffiness may happen.  NB In this migration, id is a given (so non-empty).
    // NONEMPTY_FIELDS.forEach((field) => {
    //   if (data[field].length === 0) {
    //     body[field] = 'NA'
    //   }
    // })
    // TODO call eventWriter with approriate callback to call WF to set status to INP or AWF, depending on eventWriter call, then call complete on WF callback
  },

  /**
   * Assesses event from Workfront with respect to the current state of the Store Events system for all items keyed by the Workfront id, unless WF comes through with oldState/newState.
   *
   * If none are found, then this is rather troubling and error should be thrown.
   *
   * If an event is found, for those store numbers N_SE currently in the Store Events system and those store numbers N_WF from the List of Stores field in the Workfront event,
   * the following action os taken.
   *
   * If n is in N_SE but not in N_WF, send a cancellation for that id-storeNumber pair.
   * If n is not in N_SE but is in N_WF, send a create event for that id-storeNumber pair.
   * For the rest, send an update for that id-storeNumber pair.  Just overwrite everything.  TODO send just the diff, which would reduce chance of formatting changes and size of Dynamo DB update, but doubtful if this is material at the moment.
   *
   * @param event The event to handle into Store Events.
   * @param complete The callback to inform of completion, with optional error parameter.
   */
  updateHandler: (event, complete) => {
    const id = event.data.ID
    const oldForm = event.data.oldState.parameterValues
    const newForm = event.data.newState.parameterValues

    // let priorErr
    // const jointCallback = (err) => {
    //   if (priorErr === undefined) { // first update result
    //     if (err) {
    //       priorErr = err
    //     } else {
    //       priorErr = false
    //     }
    //   } else if (priorErr && err) { // second update result, if an error was previously received and we have a new one
    //     complete(`Update Handler - errors while taking action on event AND while notifying user: ${[priorErr, err]}`)
    //   } else if (priorErr || err) {
    //     complete(`Update Handler - error while taking action on event OR while notifying user: ${priorErr || err}`)
    //   } else { // second update result, if error was not previously seen.
    //     complete()
    //   }
    // }

    if (Object.keys(oldForm).length === 0) {
      // ignore--would only accept this in a CREATE and its presence in an UPDATE indicates a transitory state at best or non-conforming user behavior
      console.log('Previous form state was empty.  This should only happen in a CREATE event, yet this is an UPDATE.  Skipping event.')
      setTimeout(() => complete(), 0)
    } else if (Object.keys(newForm).length === 0) {
      console.log('Incorrect user behavior: form removed from Issue, rather than Issue being deleted.  Attempting to restore old state and to message user.  No change to Store Events.')

      const goodBits = impl.extract(oldForm)
      goodBits.categoryID = event.data.oldState.categoryID
      goodBits.apiKey = constants.APIKEY
      console.log('restore with ', goodBits)
      communicator.updateWF(id, goodBits, (err, res) => {
        let message = `${constants.MESSAGE.REMOVE}${event.data.oldState.name}`
        if (err || res.error) {
          console.log('WARNING: WF encountered error while trying to restore form.  Form not restored.  Error: ', err || res.error)
          message = `${message}.  The Issue is in a corrupted state and must now be Deleted.`
        } else {
          console.log('WF response on restoring form: ', res)
        }

        communicator.sendMessage(id, message, constants.APIKEY, (error, response) => {
          if (error || response.error) {
            console.log('WARNING: WF encountered error while messaging about invalid removal of form. Error: ', error || response.error)
          } else {
            console.log('WF response on sending Note regarding invalid removal of form: ', response)
          }

          complete() // NB Best efforts only on correcting behavior that is meant to be impossible, due to only one custom form being available for this queue topic.
        })
      })
    } else if (event.data.oldState.categoryID !== event.data.newState.categoryID) {
      console.log('Incorrect user behavior: form changed within same Issue, rather than Issue being deleted and new Issue being created.  Attempting to restore old categoryID and old state and to message user.  No change to Store Events.')

      const goodBits = impl.extract(oldForm)
      goodBits.categoryID = event.data.oldState.categoryID
      goodBits.apiKey = constants.APIKEY
      console.log('restore with ', goodBits)
      communicator.updateWF(id, goodBits, (err, res) => {
        let message = `${constants.MESSAGE.SWITCH}${event.data.oldState.name}`
        if (err || res.error) {
          console.log('WARNING: WF encountered error while trying to restore form.  Form not restored.  Error: ', err || res.error)
          message = `${message}.  The Issue is in a corrupted state and must now be Deleted.`
        } else {
          console.log('WF response on restoring form: ', res)
        }

        communicator.sendMessage(id, message, constants.APIKEY, (error, response) => {
          if (error || response.error) {
            console.log('WARNING: WF encountered error while messaging about invalid switching of form. Error: ', error || response.error)
          } else {
            console.log('WF response on sending Note regarding invalid switching of form: ', response)
          }

          complete() // NB Best efforts only on correcting behavior that is meant to be impossible, due to only one custom form being available for this queue topic.
        })
      })
    } else {
      const goodBitsOld = impl.extract(oldForm)
      const goodBitsNew = impl.extract(newForm)
      if (impl.compareTwoObjectsWithPrimitiveFields(goodBitsOld, goodBitsNew, true)) {
        console.log('No changes in form.  Skipping event.')
        setTimeout(() => complete(), 0)
      } else {
        const storeResult = impl.makeAndCheckListOfStores(goodBitsNew)
        const dateResult = impl.makeAndCheckDates(goodBitsNew)

        if (!storeResult.isValid) {
          communicator.sendMessage(id, constants.MESSAGE.STORES, constants.APIKEY, (err, res) => {
            if (err || res.error) {
              console.log('WF encountered error messaging about invalid stores.')
              complete(err || res.error)
            } else {
              console.log('WF response on sending Note regarding invalid stores ', res)
              complete()
            }
          })
        } else if (!dateResult.isValid) {
          communicator.sendMessage(id, constants.MESSAGE.DATES, constants.APIKEY, (err, res) => {
            if (err || res.error) {
              console.log('WF encountered error messaging about invalid dates.')
              complete(err || res.error)
            } else {
              console.log('WF response on sending Note regarding invalid dates ', res)
              complete()
            }
          })
        } else {
          // TODO process diffs between goodBitsOld and goodBitsNew, as follows:
          // If n is in oldListOfStores but not in newListOfStores, send a cancellation for that id-storeNumber pair.
          // If n is not in oldListOfStores but is in newListOfStores, send a create event for that id-storeNumber pair.
          // For the rest, send an update for that id-storeNumber pair.  Just send the newState for those fields with diffs, or maybe just send the whole newState, might be safer.

          // TODO call eventWriter with appropriate callback and depending on Store Events eventWriter call, send Note saying what happened, and *then* call complete on WF Note callback
          communicator.sendMessage(id, constants.MESSAGE.GOOD, constants.APIKEY, (err, res) => {
            if (err || res.error) {
              console.log('WF encountered error messaging about successful update of Store Events.')
              complete(err || res.error)
            } else {
              console.log('WF response on sending Note regarding successful update of Store Events ', res)
              complete()
            }
          })
        }
      }
    }
  },

  /**
   * Sends a cancellation event to the Store Events system for all items keyed by the Workfront id.
   *
   * NB that Workfront DELETE events have a
   * much pared down fields field, containing only ID and Obj Code, no project ID, no stores.  Thus, if we want to avoid sending deletes on
   * IDs that belong to other projects, we need to check with Store Events first if the ID is one of ours.  (It won't do anything with an
   * irrelevant ID, but it just adds to irrelevant writes to the Dynamo.)

   * @param event The event to cancel in Store Events (since it has been deleted from Workfront).
   * @param complete The callback to inform of completion, with optional error parameter.
   */
  deleteHandler: (event, complete) => {
    // const id = event.data.ID

    // NB No fields to validate

    // TODO call Store Events GET endpoint, decide if you need to send a cancel event or just pass.
    // Can maintain a cache of eventIds and only call endpoint if not found in cache (and update cache each time).
    // TODO cancel what you need to.

    console.log('Received a DELETE event.  Code not implemented.') // TODO remove
    setTimeout(() => complete(), 0) // TODO remove
  },
}

console.log('Voila, les schemas:', createSchema, updateSchema, deleteSchema) // TODO remove this
kh.registerSchemaMethodPair(createSchema, impl.createHandler)
kh.registerSchemaMethodPair(updateSchema, impl.updateHandler)
kh.registerSchemaMethodPair(deleteSchema, impl.deleteHandler)

module.exports = {
  processKinesisEvent: kh.processKinesisEvent.bind(kh),
}

// console.log(`${constants.MODULE} - CONST: ${JSON.stringify(constants, null, 2)}`)
// console.log(`${constants.MODULE} - ENV:   ${JSON.stringify(process.env, null, 2)}`)
