

const aws = require('aws-sdk') // eslint-disable-line import/no-unresolved, import/no-extraneous-dependencies

const WF = require('workfront-subscriptions')

const wf = WF(process.env.WFAPI_KEY, process.env.WFAPI_ENDPOINT)

const AJV = require('ajv')

const ajv = new AJV()
const makeSchemaId = schema => `${schema.self.vendor}/${schema.self.name}/${schema.self.version}`

// To validate it is a Workfront subscription event
const wfEnvelopeSchema = wf.getEnvelopeSchema()
const wfEnvelope = makeSchemaId(wfEnvelopeSchema)
ajv.addSchema(wfEnvelopeSchema, wfEnvelope)

// TODO is this overkill checking here?  Should this be down to the event consumers instead?
// To validate the fields payload. NB Some services may wish to add to the list of required fields in the schemas. // TODO figure out what all the possible fields are, then set additionalProperties false.
const OBJECTS_FOR_FIELD_CHECK = ['OPTASK', 'TASK'] //= wf.getObjCodes() // TODO put in something for the other ten objCodes' schemas.
for (let i = 0; i < OBJECTS_FOR_FIELD_CHECK.length; i++) {
  const schemaToAdd = wf.getPayloadSchema(OBJECTS_FOR_FIELD_CHECK[i])
  if (schemaToAdd) {
    ajv.addSchema(schemaToAdd, makeSchemaId(schemaToAdd))
  }
}

const constants = {
  INVALID_REQUEST: 'Invalid Request: could not validate request to the schema provided.',
  INTEGRATION_ERROR: 'Kinesis Integration Error',
  API_NAME: 'Event Handler',
  EVENT_SOURCE: 'workfront/subscription',
}

const impl = {
  response: (statusCode, body) => ({
    statusCode,
    headers: {
      'Access-Control-Allow-Origin': '*', // Required for CORS support to work
      'Access-Control-Allow-Credentials': true, // Required for cookies, authorization headers with HTTPS
    },
    body,
  }),

  clientError: (error, event) => {
    console.log(error)
    return impl.response(400, `${constants.API_NAME} ${constants.INVALID_REQUEST}  ${error}.  Event: '${JSON.stringify(event)}'`)
  },

  kinesisError: (schemaName, err) => {
    console.log(err)
    return impl.response(500, `${constants.API_NAME} - ${constants.INTEGRATION_ERROR} trying to write an event for '${JSON.stringify(schemaName)}'`)
  },

  success: response => impl.response(200, JSON.stringify(response)),

  validateAndWriteKinesisEventFromApiEndpoint(event, callback) {
    const eventData = JSON.parse(event.body)
    console.log('WFE', eventData)

    // TODO less verbose errors
    if (!ajv.validate(wfEnvelope, eventData)) {
      callback(null, impl.clientError(`Could not validate event as a Workfront subscription event.  Errors: ${ajv.errorsText()}`, eventData))
    } else if (OBJECTS_FOR_FIELD_CHECK.indexOf(eventData.fields.objCode) > -1 && !ajv.validate(`com.nordstrom/workfront/${eventData.fields.objCode}/1-0-0`, eventData.fields)) { // TODO is this overkill checking here?  Should this be down to the event consumers instead?
      callback(null, impl.clientError(`Could not validate the fields payload to the schema for ${eventData.fields.objCode} .  Errors: ${ajv.errorsText()}`, eventData.fields))
    } else { // i.e., it is a Workfront event and either the fields payload is ok or not bothering to check fields for given objCode
      const origin = `${constants.EVENT_SOURCE}/${eventData.fields.objCode}/${eventData.eventType}`
      eventData.schema = `com.nordstrom/workfront/${eventData.fields.objCode}/1-0-0`
      console.log('constructed origin and schema for payload fields', origin, eventData.schema)

      const kinesis = new aws.Kinesis()
      const newEvent = {
        Data: JSON.stringify({
          schema: 'com.nordstrom/workfront/stream-ingress/1-0-0',
          timeOrigin: new Date().toISOString(),
          data: eventData,
          origin,
        }),
        PartitionKey: eventData.fields.ID,
        StreamName: process.env.STREAM_NAME,
      }

      kinesis.putRecord(newEvent, (err, data) => {
        if (err) {
          callback(null, impl.kinesisError(eventData.schema, err))
        } else {
          callback(null, impl.success(data))
        }
      })
    }
  },
}

const api = {
  /**
   * @param event The API Gateway lambda invocation event describing the event to be written to the stream.
   * @param context AWS runtime related information, e.g. log group id, timeout, request id, etc.
   * @param callback The callback to inform of completion: (error, result).
   */
  eventHandler: (event, context, callback) => {
    impl.validateAndWriteKinesisEventFromApiEndpoint(event, callback) // TODO could something from the context be useful for making a traceId?
  },
}

module.exports = {
  eventHandler: api.eventHandler,
}
