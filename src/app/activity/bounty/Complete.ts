import { CompleteRequest } from '../../requests/CompleteRequest';
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


export const completeBounty = async (request: CompleteRequest): Promise<void> => {
	Log.debug('In Complete activity');

    const getDbResult: {dbBountyResult: BountyCollection, bountyChannel: string} = await getDbHandler(request);
	// Since we are in DMs with new flow, guild might not be populated in the request
	if (request.guildId === undefined || request.guildId === null) {
		request.guildId = getDbResult.dbBountyResult.customerId;
	}
    const completedByUser = await DiscordUtils.getGuildMemberFromUserId(request.userId, request.guildId);
	const bountyCompletedFromInProgress = (getDbResult.dbBountyResult.status == BountyStatus.in_progress);
	Log.info(`${request.bountyId} bounty completed by ${completedByUser.user.tag}`);
	
    await writeDbHandler(request, completedByUser);

	let submittedByUserId: string;
	if (bountyCompletedFromInProgress) {
		submittedByUserId = getDbResult.dbBountyResult.claimedBy.discordId;
	} else {
		submittedByUserId = getDbResult.dbBountyResult.submittedBy.discordId;
	}
	const submittedByUser = await completedByUser.guild.members.fetch(submittedByUserId);
    
    const cardMessage = await BountyUtils.canonicalCard(getDbResult.dbBountyResult._id, request.activity);
	
	let creatorCompleteDM = 
        `Thank you for reviewing <${cardMessage.url}>\n` +
		`This bounty is now complete.\n`;
        
	if (!getDbResult.dbBountyResult.paidStatus || getDbResult.dbBountyResult.paidStatus === PaidStatus.unpaid) {
		creatorCompleteDM = creatorCompleteDM.concat(`Please remember to mark this bounty as paid (💰)and pay <@${submittedByUser.id}>`);
	}
	else {
		creatorCompleteDM = creatorCompleteDM.concat(
			`No further action is required for this bounty.`
		);
	}
    
    let submitterCompleteDM = `Your bounty has passed review and is now complete!\n<${cardMessage.url}>\n`;
	if (!getDbResult.dbBountyResult.paidStatus || getDbResult.dbBountyResult.paidStatus === PaidStatus.unpaid) {
		submitterCompleteDM = submitterCompleteDM.concat(`<@${completedByUser.id}> should be paying you with ${getDbResult.dbBountyResult.reward.amount} ${getDbResult.dbBountyResult.reward.currency} soon.`);
	}
	await DiscordUtils.activityNotification(submitterCompleteDM, submittedByUser );
    await DiscordUtils.activityResponse(request.commandContext, creatorCompleteDM, completedByUser);
    return;
}

/**
 * Wraps read only calls to the database.
 * Intended to be replaced with calls to the API.
 * Note that the full customer read result is left out to be forward compatible with
 *     publishing bounties to a specified discord channel or multiple discord channels.
 *     This is b/c bountyChannel will be consumed from the bounty record at every step except publish
 * @param request CompleteRequest, passed from activity initiator
 * @returns 
 */
const getDbHandler = async (request: CompleteRequest): Promise<{dbBountyResult: BountyCollection, bountyChannel: string}> => {
    const db: Db = await MongoDbUtils.connect('bountyboard');
	const bountyCollection = db.collection('bounties');
    const customerCollection = db.collection('customers');

	const dbBountyResult: BountyCollection = await bountyCollection.findOne({
		_id: new mongo.ObjectId(request.bountyId),
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
const writeDbHandler = async (request: CompleteRequest, completedByUser: GuildMember): Promise<void> => {
    const db: Db = await MongoDbUtils.connect('bountyboard');
	const bountyCollection = db.collection('bounties');

	const dbBountyResult: BountyCollection = await bountyCollection.findOne({
		_id: new mongo.ObjectId(request.bountyId),
	});

	const currentDate = (new Date()).toISOString();
	const writeResult: UpdateWriteOpResult = await bountyCollection.updateOne(dbBountyResult, {
		$set: {
			reviewedBy: {
				discordHandle: completedByUser.user.tag,
				discordId: completedByUser.user.id,
				iconUrl: completedByUser.user.avatarURL(),
			},
            // TO-DO: What is the point of status history if we publish createdAt, claimedAt... as first class fields?
            // note that createdAt, claimedAt are not part of the BountyCollection type
			reviewedAt: currentDate,
			status: BountyStatus.complete,
			resolutionNote: request.resolutionNote,
		},
		$push: {
			statusHistory: {
				status: BountyStatus.complete,
				setAt: currentDate,
			},
		},
	});

    if (writeResult.result.ok !== 1) {
        Log.error(`Write result did not execute correctly`);
        throw new Error(`Write to database for bounty ${request.bountyId} failed for Complete `);
    }
}

