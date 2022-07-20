export default class NotificationPermissionError extends Error {

	constructor(message: string) {
		super(message);

		Object.setPrototypeOf(this, NotificationPermissionError.prototype);
	}
}
