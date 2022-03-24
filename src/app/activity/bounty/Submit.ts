import { SubmitRequest } from '../../requests/SubmitRequest';
import DiscordUtils from '../../utils/DiscordUtils';
import Log, { LogUtils } from '../../utils/Log';
import { GuildMember, MessageEmbed, Message, TextChannel } from 'discord.js';
import MongoDbUtils from '../../utils/MongoDbUtils';
import mongo, { Db, UpdateWriteOpResult } from 'mongodb';
import { BountyCollection } from '../../types/bounty/BountyCollection';
import { CustomerCollection } from '../../types/bounty/CustomerCollection';
import RuntimeError from '../../errors/RuntimeError';
import { BountyStatus } from '../../constants/bountyStatus';
import { BountyEmbedFields } from '../../constants/embeds';
import { PaidStatus } from '../../constants/paidStatus';


export const submitBounty = async (request: SubmitRequest): Promise<void> => {
	Log.debug('In Submit activity');
	
    const getDbResult: {dbBountyResult: BountyCollection, bountyChannel: string} = await getDbHandler(request);
	// Since we are in DMs with new flow, guild might not be populated in the request
	if (request.guildId === undefined || request.guildId === null) {
		request.guildId = getDbResult.dbBountyResult.customerId;
	}
    const submittedByUser = await DiscordUtils.getGuildMemberFromUserId(request.userId, request.guildId);
	const createdByUser: GuildMember = await submittedByUser.guild.members.fetch(getDbResult.dbBountyResult.createdBy.discordId);
	Log.info(`${request.bountyId} bounty submitted by ${submittedByUser.user.tag}`);

    await writeDbHandler(request, submittedByUser);

	let submitterMessage: Message;
	let completorMessage: Message;
	let channelId: string;
	let messageId: string;

	if (!request.message) {
		// If we put the bounty in a DM using the new flow, find it. If not, find it in the bounty board channel

		if (getDbResult.dbBountyResult.claimantMessage !== undefined) {
			channelId = getDbResult.dbBountyResult.claimantMessage.channelId;
			messageId = getDbResult.dbBountyResult.claimantMessage.messageId;
		} else {
			channelId = getDbResult.bountyChannel;
			messageId = getDbResult.dbBountyResult.discordMessageId;
		}
		const bountyChannel = await submittedByUser.client.channels.fetch(channelId) as TextChannel;
		submitterMessage = await bountyChannel.messages.fetch(messageId).catch(e => {
			LogUtils.logError(`could not find bounty ${request.bountyId} in channel ${channelId} in guild ${request.guildId}`, e);
			throw new RuntimeError(e);
		});
    } else {
        submitterMessage = request.message;
    }

	if (getDbResult.dbBountyResult.creatorMessage !== undefined) {
		const bountyChannel: TextChannel = await createdByUser.client.channels.fetch(getDbResult.dbBountyResult.creatorMessage.channelId) as TextChannel;
		completorMessage = await bountyChannel.messages.fetch(getDbResult.dbBountyResult.creatorMessage.messageId).catch(e => {
			LogUtils.logError(`could not find bounty ${request.bountyId} in DM channel ${bountyChannel.id} in guild ${request.guildId}`, e);
			throw new RuntimeError(e);
		});
	}

	const bountyUrl = process.env.BOUNTY_BOARD_URL + request.bountyId;
	
    
    await submitBountyMessage(getDbResult.dbBountyResult, submitterMessage, completorMessage, submittedByUser, createdByUser);
	
	let creatorSubmitDM = `Please reach out to <@${submittedByUser.user.id}>. They are ready for bounty review <${bountyUrl}>`

	if (request.url) {
		creatorSubmitDM += `\nPlease review this URL:\n${request.url}`
	}

	if (request.notes) {
		creatorSubmitDM += `\nPlease review these notes:\n${request.notes}`
	}
	await createdByUser.send({ content: creatorSubmitDM });
	await submittedByUser.send({ content: `Bounty in review! Expect a message from <@${createdByUser.id}>` });
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

// Remove message from location found. Replace with new message with correct actions in correct location
export const submitBountyMessage = async (submittedBounty: BountyCollection, submitterMessage: Message, completorMessage: Message, submittedByUser: GuildMember, createdByUser: GuildMember): Promise<any> => {
	Log.debug('fetching bounty message for submit');

	let embedMessage: MessageEmbed = new MessageEmbed(submitterMessage.embeds[0]);
	await submitterMessage.delete();
	if (completorMessage) await completorMessage.delete();
	embedMessage.fields[BountyEmbedFields.status].value = BountyStatus.in_review;
	embedMessage.setColor('#d39e00');
	embedMessage.addField('Submitted by', submittedByUser.user.tag, true);

	embedMessage.setFooter({text: '🆘 - help'});
	const claimantMessage: Message = await submittedByUser.send({ embeds: [embedMessage] });
	await claimantMessage.react('🆘');

	let creatorReactionFooterText = '✅ - complete';
	if (!submittedBounty.paidStatus || submittedBounty.paidStatus === PaidStatus.unpaid) {
		creatorReactionFooterText = creatorReactionFooterText.concat(' | 💰 - mark as paid')
	}

	embedMessage.setFooter({text: creatorReactionFooterText});
	const creatorMessage: Message = await createdByUser.send({ embeds: [embedMessage] });
	await creatorMessage.react('✅');
	if (!submittedBounty.paidStatus || submittedBounty.paidStatus === PaidStatus.unpaid) {
		await creatorMessage.react('💰');
	}
	

	await updateMessageStore(submittedBounty, claimantMessage, creatorMessage);

};

// Save where we sent the Bounty message embeds for future updates
export const updateMessageStore = async (bounty: BountyCollection, claimantMessage: Message, creatorMessage: Message): Promise<any> => {
    const db: Db = await MongoDbUtils.connect('bountyboard');
    const bountyCollection = db.collection('bounties');
    const writeResult: UpdateWriteOpResult = await bountyCollection.updateOne({ _id: bounty._id }, {
        $set: {
            claimantMessage: {
                messageId: claimantMessage.id,
                channelId: claimantMessage.channelId,
            },
            creatorMessage: {
                messageId: creatorMessage.id,
                channelId: creatorMessage.channelId,
            },
        },
        $unset: { discordMessageId: "" },
    });

    if (writeResult.result.ok !== 1) {
        Log.error('failed to update submitted bounty with message Id');
        throw new Error(`Write to database for bounty ${bounty._id} failed. `);
    }

};
