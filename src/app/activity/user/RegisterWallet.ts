import { Db, UpdateWriteOpResult } from "mongodb";
import { UpsertUserWalletRequest } from "../../requests/UpsertUserWalletRequest";
import { UserCollection } from "../../types/user/UserCollection";
import MongoDbUtils from "../../utils/MongoDbUtils";
import Log from "../../utils/Log";

export const upsertUserWallet = async (request: UpsertUserWalletRequest): Promise<any> => {
    return await dbHandler(request);
}

const dbHandler = async (request: UpsertUserWalletRequest): Promise<void> => {
    const db: Db = await MongoDbUtils.connect('bountyboard');
    const userCollection = db.collection('user');

	const dbUserResult: UserCollection = await userCollection.findOne({
		userDiscordId: request.userDiscordId,
	});

    if (!dbUserResult) {
        await userCollection.insertOne({
            userDiscordId: request.userDiscordId,
        })
    }

	const writeResult: UpdateWriteOpResult = await userCollection.updateOne({userDiscordId: request.userDiscordId }, {
		$set: {
			walletAddress: request.address,
		},
	});

    if (writeResult.result.ok !== 1) {
        Log.error(`Write result did not execute correctly`);
        throw new Error(`Write to database for user ${request.userDiscordId}: ${request.address} failed`);
    }
}