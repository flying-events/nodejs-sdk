class FlyingEventsError extends Error {
    constructor(message, code) {
        super(message, code);
        this.message = message;
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }

}
module.exports = FlyingEventsError;
