import { Collection, ObjectId } from 'mongodb';

export interface CustomerCollection extends Collection {
	_id: ObjectId,
    customerId: string,
    customer_id?: string,
    bountyChannel: string,
    lastListMessage: string,
    name: string,
    allowlistedRoles: string[]
}