export default class DMPermissionError extends Error {

	constructor(message: string) {
		super(message);

		Object.setPrototypeOf(this, DMPermissionError.prototype);
	}
}
