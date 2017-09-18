'use strict'

const fs = require('fs')
const yaml = require('js-yaml')
const path = require('path')
const spawnSync = require('child_process').spawnSync
const WF = require('workfront-subscriptions')

const secrets = yaml.safeLoad(fs.readFileSync(path.join(__dirname, '..', '..', 'private.yml'), 'utf8'))
const wf = WF(secrets.WF.apiKey, secrets.WF.apiEndpoint)

const SERVICE_ENDPOINT = 'ServiceEndpoint: '
const EVENT_HANDLER_NAME = 'eventHandler'

const OBJECTS_FOR_FIELD_CHECK = ['TASK'] //= wf.getObjCodes() // TODO put in something for the other objCodes' schemas.
const EVENT_TYPES = wf.getEventTypes()

console.log(JSON.stringify(EVENT_TYPES))

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

  // checkSubscriptions() { // TODO check for previous
  // }

  subscribeEndpoint() {
    const serviceEndpoint = this.getOwnUrl()

    if (serviceEndpoint) {
      const endpointToSubscribe = `${serviceEndpoint}/${EVENT_HANDLER_NAME}`
      this.serverless.cli.log(`Subscribing ${endpointToSubscribe} to Workfront events.`)

      // TODO subscribe the lot
      wf.subscribeToEvent('TASK', null, 'CREATE', endpointToSubscribe, secrets.AWS.authToken)
        .then((res) => {
          if (res.status < 300) {
            this.serverless.cli.log('Successfully subscribed to TASK-CREATE.')
          } else {
            this.serverless.cli.log(`Subscription for TASK-CREATE was unsuccessful, with status ${res.status}.`)
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
    // TODO need to save subscription IDs somewhere.
  }
}

module.exports = ServerlessPlugin
