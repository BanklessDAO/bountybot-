import { Collection, ObjectId } from 'mongodb';

export interface UserCollection extends Collection {
	_id: ObjectId,
    userDiscordId: string,
    walletAddress: string,
}