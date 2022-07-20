export default class ConflictingMessageException extends Error {

	constructor(message: string) {
		super(message);

		Object.setPrototypeOf(this, ConflictingMessageException.prototype);
	}
}