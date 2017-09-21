const fetch = require('node-fetch')
const envelopeSchema = require('./schemas/subscription-event.json')

// NB OPTASK schema needs to be ok with more nulls; e.g., email issues don't use all the fields that store events does.
// TODO really, these schemas all need some investigation
const wfSchemas = {
  OPTASK: require('./schemas/OPTASK.json'), // eslint-disable-line global-require
  TASK: require('./schemas/TASK.json'), // eslint-disable-line global-require
  // TODO add the rest
}

// all available Workfront possibilities
const WF_CONSTANTS = {
  objCodes: ['USER', 'PORT', 'PRGM', 'PROJ', 'TASK', 'OPTASK', 'TMPL', 'PTLSEC', 'PTLTAB', 'CMPY', 'DOCU', 'NOTE'],
  eventTypes: ['CREATE', 'DELETE', 'UPDATE', 'SHARE'],
}

const impl = (apiKey, subscriptionsURL, subscribedObjCodes, subscribedEventTypes) => {
  const objCodes = []
  const eventTypes = []

  if (typeof subscribedObjCodes === 'string') {
    const candidates = subscribedObjCodes.split('|')
    for (let i = 0; i < candidates.length; i++) {
      if (WF_CONSTANTS.objCodes.indexOf(candidates[i]) > -1 && wfSchemas[candidates[i]]) {
        objCodes.push(candidates[i])
      }
    }
  }

  if (typeof subscribedEventTypes === 'string') {
    const candidates = subscribedEventTypes.split('|')
    for (let i = 0; i < candidates.length; i++) {
      if (WF_CONSTANTS.eventTypes.indexOf(candidates[i]) > -1) {
        eventTypes.push(candidates[i])
      }
    }
  }

  const composeMessage =
    (objCode, objId, eventType, url, authToken) => {
      if (objId) {
        return JSON.stringify({ objCode, objId, eventType, url, authToken })
      } else {
        return JSON.stringify({ objCode, eventType, url, authToken })
      }
    }

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

  const getPayloadSchema = (objCode) => {
    if (objCode && objCodes.indexOf(objCode) > -1) {
      return wfSchemas[objCode]
    } else {
      return null
    }
  }

  const getEnvelopeSchema = () => envelopeSchema

  const getObjCodes = () => objCodes

  const getEventTypes = () => eventTypes

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
