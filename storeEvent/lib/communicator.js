

const aws = require('aws-sdk') // eslint-disable-line import/no-unresolved, import/no-extraneous-dependencies
const https = require('https')
const querystring = require('querystring') // TODO querystring stringifies dates with quote marks, as strings, which won't work if the custom form is using the calendar form

const constants = {
  STORE_EVENTS: {
    WRITE_URL: process.env.WRITE_URL,
    WRITE_PATH: process.env.WRITE_PATH,
    READ_URL: process.env.READ_URL,
    READ_PATH: process.env.READ_PATH,
    STORE_EVENTS_API_KEY: process.env.STORE_EVENTS_API_KEY,
  },
  WF: {
    URL: {
      hostName: process.env.WF_HOSTNAME,
      path: process.env.WF_PATH,
    },
    UPDATE_VERB: 'PUT',
    CREATE_VERB: 'POST',
  },
}

const impl = {

  postStoreEvents: (data, callback) => {
    const body = JSON.stringify(data)

    // TODO might want to check these first
    const credentials = aws.config.credentials
    const region = aws.config.region

    const endpoint = new aws.Endpoint(constants.STORE_EVENTS.WRITE_URL)
    const request = new aws.HttpRequest(endpoint)

    request.path = constants.STORE_EVENTS.WRITE_PATH
    request.method = 'POST'
    request.region = region
    request.host = endpoint.host
    request.body = body
    request.headers.Host = endpoint.host
    request.headers['Content-Type'] = 'application/x-www-form-urlencoded'
    request.headers['Content-Length'] = Buffer.byteLength(body)

    const signer = new aws.Signers.V4(request, 'execute-api')
    signer.addAuthorization(credentials, new Date())

    const postRequest = https.request(request, (response) => {
      let result = ''
      response.on('data', d => (result += d)) // eslint-disable-line  no-return-assign
      response.on('end', () => callback(null, result))
      response.on('error', error => callback(error))
    })

    postRequest.write(body)
    postRequest.end()
  },

  // getStoreEvents: (data, callback) => {
  //   // TODO Simple get with apiKey
  //   const apiKey = constants.STORE_EVENTS.STOTE_EVENTS_API_KEY
  // },

  updateWFIssue: (id, data, callback) => {
    // e.g., data = {
    //   apiKey,
    //   status,
    //   'DE:System comments': comments,
    // }

    const options = {
      hostname: constants.WF.URL.hostName,
      path: `${constants.WF.URL.path}issue/${id}?${querystring.stringify(data)}`,
      method: constants.WF.UPDATE_VERB,
    }

    const postRequest = https.request(options, (response) => {
      let result = ''
      response.on('data', d => (result += d)) // eslint-disable-line  no-return-assign
      response.on('end', () => callback(null, result))
      response.on('error', error => callback(error))
    })

    // postRequest.write(data)  // NB Workfront does not use body, but rather query parameters
    postRequest.end()
  },

  createNoteForIssue: (issueId, noteText, apiKey, callback) => {
    const data = {
      noteObjCode: 'OPTASK',
      objID: issueId,
      opTaskID: issueId,
      noteText,
      apiKey,
    }

    const options = {
      hostname: constants.WF.URL.hostName,
      path: `${constants.WF.URL.path}note?${querystring.stringify(data)}`,
      method: constants.WF.CREATE_VERB,
    }

    const postRequest = https.request(options, (response) => {
      let result = ''
      response.on('data', d => (result += d)) // eslint-disable-line  no-return-assign
      response.on('end', () => callback(null, result))
      response.on('error', error => callback(error))
    })

    // postRequest.write(data)  // NB Workfront does not use body, but rather query parameters
    postRequest.end()
  },
}

module.exports = {
  updateWF: impl.updateWFIssue,
  sendMessage: impl.createNoteForIssue,
}
