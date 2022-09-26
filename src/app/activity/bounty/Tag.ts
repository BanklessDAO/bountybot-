import mongo, { Db, UpdateWriteOpResult } from "mongodb";
import { TagRequest } from "../../requests/TagRequest";
import Log from "../../utils/Log"
import MongoDbUtils from "../../utils/MongoDbUtils";
import DiscordUtils from "../../utils/DiscordUtils";
import BountyUtils from "../../utils/BountyUtils";
import { BountyCollection } from '../../types/bounty/BountyCollection'
import { CustomerCollection } from '../../types/bounty/CustomerCollection'

export const tagBounty = async (request: TagRequest): Promise<void> => {
    Log.debug(`In Tag activity`);
    
    const getDbResult: { dbBountyResult: BountyCollection, bountyChannel: string } = await getDbHandler(request);
    
    await writeDbHandler(request);
    
    const bountyCard = await BountyUtils.canonicalCard(getDbResult.dbBountyResult._id, request.activity);
    
    const tagResponse = `You have added a new tag to the bounty: ${bountyCard.embeds[0].title}`
    await DiscordUtils.activityResponse(request.commandContext, request.buttonInteraction, tagResponse, bountyCard.url);
    return;
}

const writeDbHandler = async (request: TagRequest): Promise<void> => {
    const db: Db = await MongoDbUtils.connect('bountyboard');
	const bountyCollection = db.collection('bounties');

	const writeResult: UpdateWriteOpResult = await bountyCollection.updateOne( {_id: new mongo.ObjectId(request.bountyId)}, {
		$push: {
			tags: request.tag,
		},
	});
}

const getDbHandler = async (request: TagRequest): Promise<{dbBountyResult: BountyCollection, bountyChannel: string}> => {
    const db: Db = await MongoDbUtils.connect('bountyboard');
    const bountyCollection = db.collection('bounties');
    const customerCollection = db.collection('customers');

    const dbBountyResult: BountyCollection = await bountyCollection.findOne({
	_id: new mongo.ObjectId(request.bountyId),
    });

    const dbCustomerResult: CustomerCollection = await customerCollection.findOne({
        customerId: request.guildId,
    });

    return {
        dbBountyResult: dbBountyResult,
        bountyChannel: dbCustomerResult.bountyChannel
    }
}


