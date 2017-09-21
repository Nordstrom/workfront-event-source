'use strict'

const fs = require('fs')
const yaml = require('js-yaml')
const path = require('path')
const spawnSync = require('child_process').spawnSync
const WF = require('workfront-subscriptions')

const EVENT_HANDLER_NAME = 'eventHandler'
const SERVICE_ENDPOINT = 'ServiceEndpoint: '

const secrets = yaml.safeLoad(fs.readFileSync(path.join(__dirname, '..', '..', 'private.yml'), 'utf8'))
const config = yaml.safeLoad(fs.readFileSync(path.join(__dirname, '..', '..', 'project.yml'), 'utf8'))
const wf = WF(secrets.WF.apiKey, secrets.WF.apiEndpoint, config.eventHandler.objCodes, config.eventHandler.eventTypes)

class ServerlessPlugin {
  constructor(serverless, options) {
    this.serverless = serverless
    this.options = options

    this.hooks = {
      'after:deploy:deploy': this.subscribeEndpoint.bind(this),
      // 'before:remove:remove': this.unsubscribeEndpoint.bind(this),
    }

    this.getOwnUrl = this.getOwnUrl.bind(this)
    // this.checkSubscriptions = this.checkSubscriptions.bind(this)
    // this.getSubscriptions = this.getSubscriptions.bind(this)
    // this.getSubscriptionIds = this.getSubscriptionIds.bind(this)
  }

  getOwnUrl() {
    // const process = spawnSync(`${__dirname}/../../node_modules/.bin/sls`, ['info', '-s', this.serverless.variables.service.custom.stage])
    const shellCommand = `../node_modules/.bin/sls info -v -s ${ this.serverless.variables.service.custom.stage} | grep ${SERVICE_ENDPOINT}`
    const process = spawnSync('sh', ['-c', shellCommand], { stdio: 'pipe' , cwd: `${__dirname}/..`})
    const stdout = process.stdout.toString()
    const stderr = process.stderr.toString()

    if(stderr) {
      this.serverless.cli.log(stderr)
    }

    if(stdout) {
      return stdout.substring(SERVICE_ENDPOINT.length).trim()
    }

    return null
  }

  // checkSubscriptions(url, objCode, eventType) { // TODO check for previous
  //  // call getSubscriptions(url), dig through result to check for objCode/eventType and NO objId, since this will be subscribing to all
  // }

  // getSubscriptionIds(url) { // TODO get all subscribed Ids
  //  // call getSubscriptions(url), map to just the subscriptionIds
  // }

  // getSubscriptions(url) { // TODO call subscriptions/list and filter by url
  //  return [] // array of subscription jsons
  // }

  subscribeEndpoint() {
    const serviceEndpoint = this.getOwnUrl()

    if (serviceEndpoint) {
      const endpointToSubscribe = `${serviceEndpoint}/${EVENT_HANDLER_NAME}`
      this.serverless.cli.log(`Subscribing ${endpointToSubscribe} to Workfront events.`)

      // TODO subscribe the lot, not just a single pair
      wf.subscribeToEvent(wf.getObjCodes()[0], null, wf.getEventTypes()[0], endpointToSubscribe, secrets.AWS.authToken)
        .then((res) => {
          if (res.status < 300) {
            this.serverless.cli.log(`Successfully subscribed to ${wf.getObjCodes()[0]}-${wf.getEventTypes()[0]}.`)
          } else {
            this.serverless.cli.log(`Subscription for ${wf.getObjCodes()[0]}-${wf.getEventTypes()[0]} was unsuccessful, with status ${res.status}.`)
            this.serverless.cli.log(JSON.stringify(res))
          }
        })
        .catch((err) => {
          this.serverless.cli.log(JSON.stringify(err))
        })
    } else {
      this.serverless.cli.log('No endpoint found.  No subscriptions attempted.')
    }
  }

  unsubscribeEndpoint() {
    // TODO
    // call getSubscriptionIds, then fire off wf.deleteSubscription for all
  }
}

module.exports = ServerlessPlugin
