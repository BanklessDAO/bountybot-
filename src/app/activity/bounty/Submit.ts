import { SubmitRequest } from '../../requests/SubmitRequest';
import DiscordUtils from '../../utils/DiscordUtils';
import Log from '../../utils/Log';
import { GuildMember } from 'discord.js';
import MongoDbUtils from '../../utils/MongoDbUtils';
import mongo, { Db, UpdateWriteOpResult } from 'mongodb';
import { BountyCollection } from '../../types/bounty/BountyCollection';
import { CustomerCollection } from '../../types/bounty/CustomerCollection';
import { BountyStatus } from '../../constants/bountyStatus';
import BountyUtils from '../../utils/BountyUtils';


export const submitBounty = async (request: SubmitRequest): Promise<void> => {
	Log.debug('In Submit activity');
	
    const getDbResult: {dbBountyResult: BountyCollection, bountyChannel: string} = await getDbHandler(request);
	// Since card may have been in a DM, guild might not be populated in the request
	if (request.guildId === undefined || request.guildId === null) {
		request.guildId = getDbResult.dbBountyResult.customerId;
	}
    const submittedByUser = await DiscordUtils.getGuildMemberFromUserId(request.userId, request.guildId);
	const createdByUser: GuildMember = await submittedByUser.guild.members.fetch(getDbResult.dbBountyResult.createdBy.discordId);
	Log.info(`${request.bountyId} bounty submitted by ${submittedByUser.user.tag}`);

    await writeDbHandler(request, submittedByUser);

    const cardMessage = await BountyUtils.canonicalCard(getDbResult.dbBountyResult._id, request.activity);

	let creatorSubmitDM = `Please reach out to <@${submittedByUser.user.id}>. They are ready for bounty review <${cardMessage.url}>`

	if (request.url) {
		creatorSubmitDM += `\nPlease review this URL:\n${request.url}`
	}

	if (request.notes) {
		creatorSubmitDM += `\nPlease review these notes:\n${request.notes}`
	}
	await DiscordUtils.activityNotification(creatorSubmitDM, createdByUser);
	await DiscordUtils.activityResponse(request.commandContext, request.buttonInteraction, `Bounty in review! Expect a message from <@${createdByUser.id}>: <${cardMessage.url}>`);
    return;
}

/**
 * Wraps read only calls to the database.
 * Intended to be replaced with calls to the API.
 * Note that the full customer read result is left out to be forward compatible with
 *     publishing bounties to a specified discord channel or multiple discord channels.
 *     This is b/c bountyChannel will be consumed from the bounty record at every step except Submit
 * @param request SubmitRequest, passed from activity initiator
 * @returns 
 */
const getDbHandler = async (request: SubmitRequest): Promise<{dbBountyResult: BountyCollection, bountyChannel: string}> => {
    const db: Db = await MongoDbUtils.connect('bountyboard');
	const bountyCollection = db.collection('bounties');
    const customerCollection = db.collection('customers');

	const dbBountyResult: BountyCollection = await bountyCollection.findOne({
		_id: new mongo.ObjectId(request.bountyId),
		status: BountyStatus.in_progress,
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
const writeDbHandler = async (request: SubmitRequest, submittedByUser: GuildMember): Promise<void> => {
    const db: Db = await MongoDbUtils.connect('bountyboard');
	const bountyCollection = db.collection('bounties');

	const dbBountyResult: BountyCollection = await bountyCollection.findOne({
		_id: new mongo.ObjectId(request.bountyId),
		status: BountyStatus.in_progress,
	});

	const currentDate = (new Date()).toISOString();
	const writeResult: UpdateWriteOpResult = await bountyCollection.updateOne(dbBountyResult, {
		$set: {
			submittedBy: {
				discordHandle: submittedByUser.user.tag,
				discordId: submittedByUser.user.id,
				iconUrl: submittedByUser.user.avatarURL(),
			},
			submittedAt: currentDate,
			status: BountyStatus.in_review,
			submissionUrl: request.url,
			submissionNotes: request.notes,
		},
		$push: {
			statusHistory: {
				status: BountyStatus.in_review,
				setAt: currentDate,
			},
		},
	});

    if (writeResult.result.ok !== 1) {
        Log.error(`Write result did not execute correctly`);
        throw new Error(`Write to database for bounty ${request.bountyId} failed for Submit `);
    }
}
