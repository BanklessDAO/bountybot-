import { Collection, ObjectId } from 'mongodb';

export interface RequestCollection extends Collection {
	_id: ObjectId,
    requestJSON: string,
}