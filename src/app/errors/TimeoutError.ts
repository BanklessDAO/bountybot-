export default class TimeoutError extends Error {

	constructor(operation: string) {
		super(`Event handler for ${operation} has timed out`);

		Object.setPrototypeOf(this, TimeoutError.prototype);
	}
}