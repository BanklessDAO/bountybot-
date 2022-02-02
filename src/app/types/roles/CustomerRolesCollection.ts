import { Snowflake } from 'discord-api-types';
import { Collection, ObjectId } from 'mongodb';

export interface CustomerRolesCollection extends Collection {
	_id: ObjectId,
    customerId: string,
    roles: {
        rolesMap: Record<Snowflake, string>,
    }
}