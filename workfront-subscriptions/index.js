const fetch = require('node-fetch')

const WF_CONSTANTS = {
  objCodes: ['USER', 'PORT', 'PRGM', 'PROJ', 'TASK', 'OPTASK', 'TMPL', 'PTLSEC', 'PTLTAB', 'CMPY', 'DOCU', 'NOTE'],
  eventTypes: ['CREATE', 'DELETE', 'UPDATE', 'SHARE'],
}

const impl = (apiKey, subscriptionsURL) => {
  const composeMessage =
    (objCode, objId, eventType, url, authToken) =>
      JSON.stringify({ objCode, objId, eventType, url, authToken })

  const subscribeToEvent = (objCode, objId, eventType, url, authToken) => {
    const options = {
      method: 'POST',
      body: composeMessage(objCode, objId, eventType, url, authToken),
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/json',
      },
    }

    return fetch(subscriptionsURL, options)
  }

  const deleteSubscription = (subscriptionId) => {
    const options = {
      method: 'DELETE',
      headers: { Authorization: apiKey },
    }

    return fetch(`${subscriptionsURL}/${subscriptionId}`, options)
  }

  const getPayloadSchema = (schemaFile) => {
    if (schemaFile && WF_CONSTANTS.objCodes.indexOf(schemaFile) > -1) {
      return require(`./schemas/${schemaFile}.json`) // eslint-disable-line global-require, import/no-dynamic-require
    } else {
      return null
    }
  }

  const getEnvelopeSchema = () => require('./schemas/subscription-event.json') // eslint-disable-line global-require

  const getObjCodes = () => WF_CONSTANTS.objCodes

  const getEventTypes = () => WF_CONSTANTS.eventTypes

  return {
    subscribeToEvent,
    deleteSubscription,
    getPayloadSchema,
    getEnvelopeSchema,
    getObjCodes,
    getEventTypes,
  }
}

module.exports = impl
