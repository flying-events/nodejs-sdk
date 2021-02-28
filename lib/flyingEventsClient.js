const FlyingEventsError = require('../lib/exception/flyingEventsError');
const Environment = {LIVE: 'LIVE', TEST: 'TEST'};
const https = require('https')
const jwtDecode = require('jwt-decode')
const retry = require("retry");

const DEFAULT_ERROR_CODE = -1;
const DEFAULT_TIMEOUT_MS = 30000;
const RETRY_CONFIG = {
    retries: 20,
    factor: 5, //The exponential factor to use. Default is 2.
    minTimeout:  60 * 1000,  // The number of milliseconds before starting the first retry. Default is 1000.
    maxTimeout:  20 * 60 * 1000, //The maximum number of milliseconds between two retries. Default is Infinity.
    randomize: true,
};
/**
 * Makes a request to the Medium API.
 *
 * @param {Object} options
 * @param callback
 */
FlyingEventsClient.prototype._makeRequest = function (options, callback) {
    const requestParams = {
        host: 'app.flying.events',
        port: 443,
        method: options.method,
        path: options.path
    };
    const req = https.request(requestParams, function (res) {
        const body = [];
        res.setEncoding('utf-8')
        res.on('data', function (data) {
            body.push(data)
        })
        res.on('end', function () {
            const responseText = body.join('');
            const statusType = Math.floor(res.statusCode / 100);
            if (statusType === 4 || statusType === 5) {
                callback(new FlyingEventsError(responseText, res.statusCode), null, res.headers)
            } else if (statusType === 2) {
                callback(null, responseText, res.headers)
            } else {
                callback(new FlyingEventsError('Unexpected response', DEFAULT_ERROR_CODE), null, res.headers)
            }
        })
    }.bind(this)).on('error', function (err) {
        callback(new FlyingEventsError(err, DEFAULT_ERROR_CODE), null, null)
    });

    req.setHeader('Content-Type', 'application/json')
    req.setHeader('Accept', 'application/json')
    req.setHeader('Accept-Charset', 'utf-8')

    if(this._accessToken && this._accessToken.length > 0)
        req.setHeader('Authorization', 'Bearer ' + this._accessToken)

    req.setTimeout(DEFAULT_TIMEOUT_MS, function () {
        // Aborting a request triggers the 'error' event.
        req.destroy()
    })

    if (options.data) {
        let data = options.data;
        if (typeof data == 'object') {
            data = JSON.stringify(data)
        }
        req.write(data)
    }
    req.end()
}

/**
 * Enforces that given options object (first param) defines
 * all keys requested (second param). Raises an error if any
 * is missing.
 *
 * @param {Object} options
 * @param {string[]} requiredKeys
 */
FlyingEventsClient.prototype._enforce = function (options, requiredKeys) {
    if (!options) {
        throw new FlyingEventsError('Parameters for this call are undefined')
    }
    requiredKeys.forEach(function (requiredKey) {
        if (!options[requiredKey]) throw new FlyingEventsError('Missing required parameter "' + requiredKey + '"', DEFAULT_ERROR_CODE)
    })
}

/**
 * Check if JWT token expired and renew it
 *
 * @param callback
 */
FlyingEventsClient.prototype._checkJwtToken = function (callback) {
    let tokenExpired = false;
    try {
        const decodedToken = jwtDecode(this._accessToken);
        if (decodedToken.exp * 1000 < Date.now()) {
            tokenExpired = true;
        }
    } catch (e) {
        tokenExpired = true;
    }
    callback(tokenExpired);


}

/**
 * Send request to get new JWT token
 *
 * @param callback
 */
FlyingEventsClient.prototype._requestAccessToken = function (callback) {
    this._checkJwtToken(function (tokenExpired) {
        if (tokenExpired) {
            this._makeRequest({
                method: 'POST',
                path: '/api/application/request-token',
                contentType: 'application/json',
                data: {
                    applicationKey: this._applicationKey,
                    applicationSecret: this._applicationSecret,
                }
            }, function (err, data, headers) {
                if (err)
                    throw err;
                this._accessToken = headers.authorization;
                callback()
            }.bind(this))
        } else {
            callback();
        }
    }.bind(this));
}

/**
 * Send Event to fail safe end point
 *
 * @param {{
 *  subscriberId: string,
 * }} params
 * @param callback
 */
FlyingEventsClient.prototype.requestSubscriberToken = function (params, callback) {
    this._enforce(params, ['subscriberId'])
    this._requestAccessToken(function () {
        this._makeRequest({
            method: 'POST',
            path: '/api/subscriber/' + params.subscriberId + '/request-token',
            data: {environment: this._environment}
        }, function (err, data, headers) {
            if(err)
                throw err;
            callback(err, headers.authorization)
        }.bind(this))
    }.bind(this));
}

/**
 * Send Event to fail safe end point
 *
 * @param {{
 *  eventName: string,
 *  payload: string,
 *  subscribersIds: array,
 * }} params
 * @param callback
 */
FlyingEventsClient.prototype._sendToFailsafe = function (params, callback) {
    this._makeRequest({
        method: 'POST',
        path: '/api/failsafe/send-event',
        data: params
    }, function (err, data, headers) {
        callback(err, data)
    }.bind(this))
}


/**
 * Set JWT token used
 *
 */
FlyingEventsClient.prototype._setAccessToken = function (jwtToken) {
    this._accessToken = jwtToken;
}

FlyingEventsClient.prototype._setRetryConfiguration = function(config){
    this._retryConfigs = config;
}
/**
 * Send Event
 *
 * @param {{
 *  eventName: string,
 *  payload: string,
 *  subscribersIds: array,
 * }} params
 * @param callback
 */
FlyingEventsClient.prototype.sendEvent = function (params, callback) {
    this._enforce(params, ['eventName', 'payload', 'subscribersIds']);
    params.environment = this._environment;
    const operation = retry.operation(this._retryConfigs);
    operation.attempt( async (currentAttempt) => {
        console.log('Sending event attempt#', currentAttempt, 'eventName',params.eventName);
        this._requestAccessToken(function () {
            this._makeRequest({
                method: 'POST',
                path: '/api/worker/send-event',
                data: params
            }, function (err, data, headers) {
                if (err) {
                    const statusType = Math.floor(err.code / 100);
                    if (statusType === 5) {
                        this._sendToFailsafe(params, function (err, data) {
                            if(err) {
                                const failSafeStatusType = Math.floor(err.code / 100);
                                if (failSafeStatusType === 5 || err.code === 408) {
                                    if (operation.retry(err)) return;
                                }
                            }
                            callback(err,data);
                        });
                    } else {
                        callback(err, data);
                    }
                } else {
                    callback(err, data)
                }
            }.bind(this))
        }.bind(this));
    });
}

/**
 * The core client.
 *
 * @param {{
 *  applicationKey: string,
 *  applicationSecret: string,
 *  environment: string,
 * }} params
 * @constructor
 */
function FlyingEventsClient(params) {
    this._enforce(params, ['applicationKey', 'applicationSecret', 'environment'])
    this._applicationKey = params.applicationKey
    this._applicationSecret = params.applicationSecret
    this._environment = params.environment;
    if (this._environment !== Environment.LIVE && this._environment !== Environment.TEST) {
        throw new FlyingEventsError("Error with environment - please use available environment types (LIVE, TEST)", DEFAULT_ERROR_CODE);
    }
    this._accessToken = '';
    this._retryConfigs = RETRY_CONFIG;
}


module.exports = {
    FlyingEventsClient: FlyingEventsClient,
    FlyingEventsError: FlyingEventsError,
    Environment: Environment
}
