// NB Many of the comments become irrelevant IF the new release of Workfront turns out to provide old state and new state in the way we hope.

const KH = require('kinesis-handler') // eslint-disable-line import/no-unresolved
const WF = require('workfront-subscriptions')
const communicator = require('./lib/communicator')

const wf = WF(process.env.API_KEY, process.env.API_ENDPOINT, process.env.OBJ_CODE, process.env.EVENT_TYPES)

const eventSchema = wf.getStreamSchema()
const issueSchema = wf.getPayloadSchema(process.env.OBJ_CODE)
// TODO If we don't want to mess about with the schemas here, we need to provide one of each in the workfront-subscriptions,
// which gets quite cluttered and would ideally have the family relate to one parent, rather than multiple copies of mostly the same thing.
// const createHeader = Object.assign({}, issueSchema.self)
const updateHeader = Object.assign({}, issueSchema.self)
const deleteHeader = Object.assign({}, issueSchema.self)
// createHeader.name `${createHeader.name}/CREATE/${process.env.CATEGORY_ID}`
updateHeader.name = `${updateHeader.name}/UPDATE/${process.env.CATEGORY_ID}`
deleteHeader.name = `${deleteHeader.name}/DELETE`
// const createSchema = Object.assign({}, issueSchema)
const updateSchema = Object.assign({}, issueSchema)
const deleteSchema = Object.assign({}, issueSchema)
// createSchema.self = createHeader
updateSchema.self = updateHeader
deleteSchema.self = deleteHeader

const constants = {
  // self
  MODULE: 'storeEvent/eventConsumer.js',
  NONE: 'NONE',
  // methods
  METHOD_GENERATE_STORE_EVENTS: 'createHandler',
  // Workfront ApiKey
  APIKEY: process.env.API_KEY,
}

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

/**
 * Example event:
   {
       "schema": "com.nordstrom/workfront/stream-ingress/1-0-0",
       "origin": "workfront/subscription/OPTASK/UPDATE",
       "timeOrigin": "2017-02-28T23:29:20.171Z",
       "data" : {
          "schema": "com.nordstrom/workfront/OPTASK/UPDATE/599db3ec00552b4b5a7e9216d1585a83/1-0-0",
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

  /**
   * Sends a create event to the Store Events system for all items keyed by the Workfront id and the store number, for each store number in the List of Stores.
   *
   * NB Actually, this should not be triggered directly by a Workfront event.  It is dangerous to respond to CREATEs from Workfront because these are generated by POSTing to the API, by using the New Issue
   * button on the GUI, by copying from the GUI (in some half-baked state), and by any entry into a previously unpopulated field in an ALREADY existing issue.
   * The last two cases are dangerous, particularly the final one, which implies you want to CREATE an already existing deal, with an already existing ID.
   * This wouldn't be a problem if you checked the Store Events endpoint before doing anything, but then that's just what you do on an update anyway, so might
   * as well just handle it all through UPDATE, which allows you to get around the third case a bit by allowing the user to signal he is ready to "commit".
   *
   * @param event The event to create in Store Events (since it has been newly created from Workfront, with a new Workfront id).
   * @param complete The callback to inform of completion, with optional error parameter.
   */
  // createHandler: (event, complete) => {
  //   // TODO put together rest of store event
  //   // TODO ensure no empty strings on the fields where iffiness may happen.  NB In this migration, id is a given (so non-empty).
  //   // NONEMPTY_FIELDS.forEach((field) => {
  //   //   if (data[field].length === 0) {
  //   //     body[field] = 'NA'
  //   //   }
  //   // })
  //   // TODO call eventWriter with approriate callback to call WF to set status to INP or AWF, depending on eventWriter call, then call complete on WF callback
  // },

  /**
   * Assesses event from Workfront with respect to the current state of the Store Events system for all items keyed by the Workfront id.
   *
   * If none are found, then we need to create the Store Event, by calling createHandler.
   *
   * If an event is found, for those store numbers N_SE currently in the Store Events system and those store numbers N_WF from the List of Stores field in the Workfront event,
   * the following action os taken.
   *
   * If n is in N_SE but not in N_WF, send a cancellation for that id-storeNumber pair.
   * If n is not in N_SE but is in N_WF, send a create event for that id-storeNumber pair.
   * Otherwise, send an update for that id-storeNumber pair.  Just overwrite everything.  TODO send just the diff, which would reduce chance of formatting changes and size of Dynamo DB update, but doubtful if this is material at the moment.
   *
   * @param event The event to handle into Store Events.
   * @param complete The callback to inform of completion, with optional error parameter.
   */
  updateHandler: (event, complete) => {
    const id = event.data.ID
    const form = event.data.parameterValues
    const storeResult = impl.makeAndCheckListOfStores(form)
    const dateResult = impl.makeAndCheckDates(form)

    const data = {
      apiKey: constants.APIKEY,
    }

    if (!storeResult.isValid) {
      setTimeout(() => {
        data.status = 'AWF'
        data['DE:System comments'] = 'List of Stores was not a string.' // TODO Be a bit more forthcoming if you do implement store validation of some sort.

        communicator.updateWF(id, data, (err, res) => {
          if (err) {
            complete(err)
          } else {
            console.log('WF response ', res) // TODO remove
            complete()
          }
        })
      }, 0)
    } else if (!dateResult.isValid) {
      setTimeout(() => {
        data.status = 'AWF'
        data['DE:System comments'] = 'Dates were inconsistent.  Please check.' // TODO Be a bit more forthcoming with what exactly was wrong.

        communicator.updateWF(id, data, (err, res) => {
          if (err) {
            complete(err)
          } else {
            console.log('WF response ', res) // TODO remove
            complete()
          }
        })
      }, 0)
    } else {
      // TODO put together rest of store event
      // TODO ensure no empty strings on the fields where iffiness may happen.  NB In this migration, id is a given (so non-empty).
      // NONEMPTY_FIELDS.forEach((field) => {
      //   if (data[field].length === 0) {
      //     body[field] = 'NA'
      //   }
      // })

      // TODO call eventWriter with approriate callback to call WF to set status to INP or AWF, depending on eventWriter call, then call complete on WF callback
      setTimeout(() => {
        data.status = 'INP'
        data['DE:System comments'] = 'Theoretically, event has been written successfully, though this has not yet been implemented.' // TODO update this message.

        communicator.updateWF(id, data, (err, res) => {
          if (err) {
            complete(err)
          } else {
            console.log('WF response ', res) // TODO remove
            complete()
          }
        })
      }, 0)
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

// console.log('Voila, les schemas:', updateSchema, deleteSchema) // TODO remove this
// kh.registerSchemaMethodPair(createSchema, impl.createHandler)
kh.registerSchemaMethodPair(updateSchema, impl.updateHandler)
kh.registerSchemaMethodPair(deleteSchema, impl.deleteHandler)

module.exports = {
  processKinesisEvent: kh.processKinesisEvent.bind(kh),
}

// console.log(`${constants.MODULE} - CONST: ${JSON.stringify(constants, null, 2)}`)
// console.log(`${constants.MODULE} - ENV:   ${JSON.stringify(process.env, null, 2)}`)