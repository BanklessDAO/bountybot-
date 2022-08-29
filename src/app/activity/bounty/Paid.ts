import { PaidRequest } from '../../requests/PaidRequest';
import DiscordUtils from '../../utils/DiscordUtils';
import Log from '../../utils/Log';
import { GuildMember } from 'discord.js';
import MongoDbUtils from '../../utils/MongoDbUtils';
import mongo, { Db, UpdateWriteOpResult } from 'mongodb';
import { BountyCollection } from '../../types/bounty/BountyCollection';
import { CustomerCollection } from '../../types/bounty/CustomerCollection';
import { BountyStatus } from '../../constants/bountyStatus';
import { PaidStatus } from '../../constants/paidStatus';
import BountyUtils from '../../utils/BountyUtils';


export const paidBounty = async (request: PaidRequest): Promise<void> => {
	Log.debug('In Paid activity');

    const getDbResult: {dbBountyResult: BountyCollection, bountyChannel: string} = await getDbHandler(request);
	// Since we are in DMs with new flow, guild might not be populated in the request
	if (request.guildId === undefined || request.guildId === null) {
		request.guildId = getDbResult.dbBountyResult.customerId;
	}
    const paidByUser = await DiscordUtils.getGuildMemberFromUserId(request.userId, request.guildId);
	Log.info(`${request.bountyId} bounty paid by ${paidByUser.user.tag}`);
	
    await writeDbHandler(request, paidByUser);

    const cardMessage = await BountyUtils.canonicalCard(getDbResult.dbBountyResult._id, request.activity);
	
	const creatorPaidDM = 
        `Thank you for marking your bounty as paid.\n` +
        `If you haven't already, please remember to tip <@${getDbResult.dbBountyResult.claimedBy.discordId}>`;

    
    await DiscordUtils.activityResponse(request.commandContext, request.buttonInteraction, creatorPaidDM, cardMessage.url);
    return;
}

/**
 * Wraps read only calls to the database.
 * Intended to be replaced with calls to the API.
 * @param request PaidRequest, passed from activity initiator
 * @returns 
 */
const getDbHandler = async (request: PaidRequest): Promise<{dbBountyResult: BountyCollection, bountyChannel: string}> => {
    const db: Db = await MongoDbUtils.connect('bountyboard');
	const bountyCollection = db.collection('bounties');
    const customerCollection = db.collection('customers');

	const dbBountyResult: BountyCollection = await bountyCollection.findOne({
		_id: new mongo.ObjectId(request.bountyId),
		status: { $nin: [BountyStatus.draft, BountyStatus.deleted] }
	});

    if (request.message) {
        return {
            dbBountyResult: dbBountyResult,
            bountyChannel: null
        }
    }

    const dbCustomerResult: CustomerCollection = await customerCollection.findOne({
        customerId: request.guildId,
    });

    return {
        dbBountyResult: dbBountyResult,
        bountyChannel: dbCustomerResult.bountyChannel
    }
}

// TODO: consider adding the previous read result as a parameter to save a db read
const writeDbHandler = async (request: PaidRequest, paidByUser: GuildMember): Promise<void> => {
    const db: Db = await MongoDbUtils.connect('bountyboard');
	const bountyCollection = db.collection('bounties');

	const dbBountyResult: BountyCollection = await bountyCollection.findOne({
		_id: new mongo.ObjectId(request.bountyId),
		status: { $nin: [BountyStatus.draft, BountyStatus.deleted] }
	});

	const currentDate = (new Date()).toISOString();
	// TODO: what's a better type here?
	let writeObject: any = {
		$set: {
			paidBy: {
				discordHandle: paidByUser.user.tag,
				discordId: paidByUser.user.id,
				iconUrl: paidByUser.user.avatarURL(),
			},
            // TO-DO: What is the point of status history if we publish createdAt, claimedAt... as first class fields?
            // note that createdAt, claimedAt are not part of the BountyCollection type
			paidAt: currentDate,
			paidStatus: PaidStatus.paid,
			resolutionNote: request.resolutionNote,
		},
	}
	const writeResult: UpdateWriteOpResult = await bountyCollection.updateOne(dbBountyResult, writeObject);

    if (writeResult.result.ok !== 1) {
        Log.error(`Write result did not execute correctly`);
        throw new Error(`Write to database for bounty ${request.bountyId} failed for Paid `);
    }
}
