import { Snowflake } from "discord-api-types";
import { Collection, Role } from "discord.js";
import { Db, UpdateWriteOpResult } from "mongodb";
import ValidationError from "../../errors/ValidationError";
import { UpsertCustomerRolesRequest } from "../../requests/UpsertCustomerRolesRequest";
import { CustomerRolesCollection } from "../../types/roles/CustomerRolesCollection";
import DiscordUtils from "../../utils/DiscordUtils";
import Log from "../../utils/Log";
import MongoDbUtils from "../../utils/MongoDbUtils";

export const upsertCustomerRoles = async (request: UpsertCustomerRolesRequest): Promise<any> => {
    Log.info(`Upserting Customer Role record for ${request.customerId}: ${request.customerName}`);
    // check customer availability
    if (!(await DiscordUtils.verifyOnlineFromGuildId(request.customerId))) {
        throw new ValidationError('Requested guild not online');
    }
    
    // get all roles for a guild
    const updatedRoles: Collection<Snowflake, Role> = await DiscordUtils.getRolesFromGuildId(request.customerId);

    // reduce to necessary data
    const rolesMap = new Map<string, string>();
    for (const [snowflake, role] of updatedRoles) {
        rolesMap.set(snowflake, role.name);
    }

    // check if record exists in Db, if not create
    // store in Db, overwriting previous record
    await dbHandler(request, rolesMap);
}


const dbHandler = async (request: UpsertCustomerRolesRequest, rolesMap: Map<string, string>): Promise<void> => {
    const db: Db = await MongoDbUtils.connect('bountyboard');
    const customerRolesCollection = db.collection('customer.roles');

	const dbCustomerRolesResult: CustomerRolesCollection = await customerRolesCollection.findOne({
		customerId: request.customerId,
	});

    if (!dbCustomerRolesResult) {
        await customerRolesCollection.insertOne({
            customerId: request.customerId,
            customer_id: request.customerId,
        })
    }

	const writeResult: UpdateWriteOpResult = await customerRolesCollection.updateOne(dbCustomerRolesResult, {
		$set: {
			roles: {
                rolesMap: rolesMap,
			},
		},
	});

    if (writeResult.result.ok !== 1) {
        Log.error(`Write result did not execute correctly`);
        throw new Error(`Write to database for customer.roles ${request.customerId}: ${request.customerName} failed`);
    }
}