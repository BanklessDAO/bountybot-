export default class ModalTimeoutError extends Error {

	constructor(message: string) {
		super(message);

		Object.setPrototypeOf(this, ModalTimeoutError.prototype);
	}
}