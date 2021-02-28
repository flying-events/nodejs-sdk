const flyingEvents = require("../");
const nock = require("nock");
const should = require("should");
const retry = require('retry');

describe("FlyingEventsClient - constructor", function () {
    it("should throw a FlyingEventsError when environment is not provided", function (done) {
        (function () {
            new flyingEvents.FlyingEventsClient({
                applicationKey: "xxx",
                applicationSecret: "yyy",
            });
        }.should.throw(flyingEvents.FlyingEventsError));
        done();
    });

    it("should throw a FlyingEventsError when applicationSecret is not provided", function (done) {
        (function () {
            new flyingEvents.FlyingEventsClient({
                applicationKey: "xxx",
                environment: "LIVE",
            });
        }.should.throw(flyingEvents.FlyingEventsError));
        done();
    });

    it("should throw a FlyingEventsError when applicationKey is not provided", function (done) {
        (function () {
            new flyingEvents.FlyingEventsClient({
                applicationSecret: "yyy",
                environment: "LIVE",
            });
        }.should.throw(flyingEvents.FlyingEventsError));
        done();
    });

    it("should throw a FlyingEventsError when only wrong environment provided", function (done) {
        (function () {
            new flyingEvents.FlyingEventsClient({
                applicationKey: "xxx",
                applicationSecret: "yyy",
                environment: "LIVEE",
            });
        }.should.throw(flyingEvents.FlyingEventsError));
        done();
    });

    it("should succeed when both applicationKey,applicationSecret and environment are provided", function (done) {
        var client = new flyingEvents.FlyingEventsClient({
            applicationKey: "xxx",
            applicationSecret: "yyy",
            environment: "LIVE",
        });
        done();
    });
});

describe("FlyingEventsClient - methods", function () {
    const jwtTokenExample =
        "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzUxMiJ9.eyJzdWIiOiI4NTkxY2U0YS1iYTRlLT" +
        "Q3YmItYjIxNC0yYmQzNGM1MWI0MDgiLCJyb2xlIjoiQVBQTElDQVRJT04iLCJleHAiOjE5MjU0NjE4NzN9." +
        "QRDjJqfLzcULk_zFXjugelY8KYwQqnjc-Bke4tRNsz1kJsLJTpI-IkBhvUSx_2YAaxrzIgZj1QTgAcRrQ_KomA";
    const applicationKey = "xxx";
    const applicationSecret = "yyy";
    const environment = "LIVE";
    const API_BASE_URL = "https://app.flying.events/";
    let client;

    beforeEach(function () {
        client = new flyingEvents.FlyingEventsClient({
            applicationKey: applicationKey,
            applicationSecret: applicationSecret,
            environment: environment,
        });
        nock.disableNetConnect();
    });

    afterEach(function () {
        nock.enableNetConnect();
        delete client;
    });

    describe("FlyingEventsClient - subscriberToken", function () {
        it("should requestSubscriberToken when provided subscriberId", function (done) {
            client._setAccessToken(jwtTokenExample);
            const subscriberData = {
                subscriberId: "5",
            };
            let requestSubscriberToken = nock(API_BASE_URL)
                .matchHeader("Authorization", "Bearer " + jwtTokenExample)
                .post("/api/subscriber/5/request-token", {
                    environment: environment,
                })
                .reply(200);
            client.requestSubscriberToken(subscriberData, function (err, data) {
                if (err) throw err;
                requestSubscriberToken.done();
                done();
            });
        });
    });

    describe("FlyingEventsClient - sendEvent", function () {
        it("should throw a FlyingEventsError when eventName are undefined", function (done) {
            (function () {
                client.sendEvent({
                    payload: "payload",
                    subscribersIds: ["1", "2"],
                });
            }.should.throw(flyingEvents.FlyingEventsError));
            done();
        });

        it("should throw a FlyingEventsError when payload are undefined", function (done) {
            (function () {
                client.sendEvent({
                    eventName: "eventName",
                    subscribersIds: ["1", "2"],
                });
            }.should.throw(flyingEvents.FlyingEventsError));
            done();
        });

        it("should throw a FlyingEventsError when subscribersIds are undefined", function (done) {
            (function () {
                client.sendEvent({
                    eventName: "eventName",
                    payload: "payload",
                });
            }.should.throw(flyingEvents.FlyingEventsError));
            done();
        });

        it("should send event to the worker when eventName,payload and subscribersIds are provided", function (done) {
            const tokenRequestData = {
                applicationKey: "xxx",
                applicationSecret: "yyy",
            };
            let tokenRequest = nock(API_BASE_URL)
                .post("/api/application/request-token", tokenRequestData)
                .reply(
                    200,
                    {},
                    {
                        Authorization: jwtTokenExample,
                    }
                );

            const configData = {
                eventName: "eventName",
                payload: "payload",
                subscribersIds: ["1", "2"],
            };
            let sendEventRequest = nock(API_BASE_URL)
                .matchHeader("Authorization", "Bearer " + jwtTokenExample)
                .post("/api/worker/send-event", configData)
                .reply(201);
            client.sendEvent(configData, function (err, data) {
                if (err) throw err;
                tokenRequest.done();
                sendEventRequest.done();
                done();
            });
        });

        it("should send event to the worker when payload is an object", function (done) {
            const tokenRequestData = {
                applicationKey: "xxx",
                applicationSecret: "yyy",
            };
            let tokenRequest = nock(API_BASE_URL)
                .post("/api/application/request-token", tokenRequestData)
                .reply(
                    200,
                    {},
                    {
                        Authorization: jwtTokenExample,
                    }
                );

            const configData = {
                eventName: "eventName",
                payload: { name: "name", id: 3 },
                subscribersIds: ["1", "2"],
            };
            let sendEventRequest = nock(API_BASE_URL)
                .matchHeader("Authorization", "Bearer " + jwtTokenExample)
                .post("/api/worker/send-event", configData)
                .reply(201);
            client.sendEvent(configData, function (err, data) {
                if (err) throw err;
                tokenRequest.done();
                sendEventRequest.done();
                done();
            });
        });

        it("should send event to the fail safe when worker fails", function (done) {
            client._setAccessToken(jwtTokenExample);
            const configData = {
                eventName: "eventName",
                payload: "payload",
                subscribersIds: ["1", "2"],
            };
            let sendEventRequest = nock(API_BASE_URL)
                .matchHeader("Authorization", "Bearer " + jwtTokenExample)
                .post("/api/worker/send-event", configData)
                .reply(500);
            let sendFailRequest = nock(API_BASE_URL)
                .matchHeader("Authorization", "Bearer " + jwtTokenExample)
                .post("/api/failsafe/send-event", configData)
                .reply(201);
            client.sendEvent(configData, function (err, data) {
                if (err) throw err;
                sendEventRequest.done();
                sendFailRequest.done();
                done();
            });
        });

        it("should retry sending event when worker and failsafe fails", function (done) {
            client._setAccessToken(jwtTokenExample);
            client._setRetryConfiguration( {
                retries: 4,
                factor: 5, //The exponential factor to use. Default is 2.
                minTimeout:   1000,  // The number of milliseconds before starting the first retry. Default is 1000.
                maxTimeout:  1000, //The maximum number of milliseconds between two retries. Default is Infinity.
                randomize: true,
            });
            const configData = {
                eventName: "eventName",
                payload: "payload",
                subscribersIds: ["1", "2"],
            };
            let sendEventRequest = nock(API_BASE_URL)
                .matchHeader("Authorization", "Bearer " + jwtTokenExample)
                .post("/api/worker/send-event", configData)
                .times(2)
                .reply(500);
            let sendFailRequest1 = nock(API_BASE_URL)
                .matchHeader("Authorization", "Bearer " + jwtTokenExample)
                .post("/api/failsafe/send-event", configData)
                .reply(500);
            let sendFailRequest2 = nock(API_BASE_URL)
                .matchHeader("Authorization", "Bearer " + jwtTokenExample)
                .post("/api/failsafe/send-event", configData)
                .reply(200);
            client.sendEvent(configData, function (err, data) {
                if(err) throw err;
                sendEventRequest.done();
                sendFailRequest1.done();
                sendFailRequest2.done();
                done();
            });
        });
    });
});
