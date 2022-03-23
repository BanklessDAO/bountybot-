import { CompleteRequest } from '../../requests/CompleteRequest';
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

    let submitterMessage: Message;
	let completorMessage: Message;
	let channelId: string;
	let messageId: string;

	if (!request.message) {
		// If we put the bounty in a DM using the new flow, find it. If not, find it in the bounty board channel

		if (getDbResult.dbBountyResult.creatorMessage !== undefined) {
			channelId = getDbResult.dbBountyResult.creatorMessage.channelId;
			messageId = getDbResult.dbBountyResult.creatorMessage.messageId;
		} else {
			channelId = getDbResult.bountyChannel;
			messageId = getDbResult.dbBountyResult.discordMessageId;
		}
		const bountyChannel = await completedByUser.client.channels.fetch(channelId) as TextChannel;
		completorMessage = await bountyChannel.messages.fetch(messageId).catch(e => {
			LogUtils.logError(`could not find bounty ${request.bountyId} in channel ${channelId} in guild ${request.guildId}`, e);
			throw new RuntimeError(e);
		});
    } else {
        completorMessage = request.message;
    }

	// This logic works for both claim -> submit -> complete and claim -> complete
	// TODO: submitterMessage is now a naming issue, as claimantMessage is also valid
	if (getDbResult.dbBountyResult.claimantMessage !== undefined) {
		const bountyChannel: TextChannel = await completedByUser.client.channels.fetch(getDbResult.dbBountyResult.claimantMessage.channelId) as TextChannel;
		submitterMessage = await bountyChannel.messages.fetch(getDbResult.dbBountyResult.claimantMessage.messageId).catch(e => {
			LogUtils.logError(`could not find bounty ${request.bountyId} in DM channel ${bountyChannel.id} in guild ${request.guildId}`, e);
			throw new RuntimeError(e);
		});
	}

	const bountyUrl = process.env.BOUNTY_BOARD_URL + request.bountyId;
	
	let submittedByUserId: string;
	if (bountyCompletedFromInProgress) {
		submittedByUserId = getDbResult.dbBountyResult.claimedBy.discordId;
	} else {
		submittedByUserId = getDbResult.dbBountyResult.submittedBy.discordId;
	}
	const submittedByUser = await completedByUser.guild.members.fetch(submittedByUserId);
    
    await completeBountyMessage(getDbResult.dbBountyResult, completorMessage, submitterMessage, completedByUser, submittedByUser);
	
	let creatorCompleteDM = 
        `Thank you for reviewing <${bountyUrl}>\n` +
		`This bounty is now complete.\n`;
        
	if (!getDbResult.dbBountyResult.paidStatus || getDbResult.dbBountyResult.paidStatus === PaidStatus.unpaid) {
		creatorCompleteDM = creatorCompleteDM.concat(`Please remember to mark this bounty as paid (💰)and pay <@${submittedByUser.id}>`);
	}
	else {
		creatorCompleteDM = creatorCompleteDM.concat(
			`No further action is required for this bounty.\n` +
			`You can search for this bounty at ${process.env.BOUNTY_BOARD_URL} or by running '/bounty list' and selecting completed by me`
		);
	}
    
    let submitterCompleteDM = `Your bounty has passed review and is now complete!\n<${bountyUrl}>\n`;
	if (!getDbResult.dbBountyResult.paidStatus || getDbResult.dbBountyResult.paidStatus === PaidStatus.unpaid) {
		submitterCompleteDM = submitterCompleteDM.concat(`<@${completedByUser.id}> should be paying you with ${getDbResult.dbBountyResult.reward.amount} ${getDbResult.dbBountyResult.reward.currency} soon.`);
	}
    
    await completedByUser.send({ content: creatorCompleteDM });
    await submittedByUser.send({ content: submitterCompleteDM });
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
			paidStatus: dbBountyResult.isIOU ? PaidStatus.paid: null,
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

export const completeBountyMessage = async (completedBounty: BountyCollection, completorMessage: Message, submitterMessage: Message, completedByUser: GuildMember, submittedByUser: GuildMember): Promise<any> => {
	Log.debug('fetching bounty message for complete')

	let embedMessage: MessageEmbed = new MessageEmbed(completorMessage.embeds[0]);
	
	await completorMessage.delete();
	if (submitterMessage) await submitterMessage.delete();
	embedMessage.fields[BountyEmbedFields.status].value = BountyStatus.complete;
	embedMessage.setColor('#01d212');
	embedMessage.addField('Completed by', completedByUser.user.tag, true);
	let completorReactionFooterText = '';
	if (!completedBounty.paidStatus || completedBounty.paidStatus === PaidStatus.unpaid) {
		completorReactionFooterText = completorReactionFooterText.concat('💰 - mark as paid')
	}
	
	embedMessage.setFooter({text: completorReactionFooterText});

	const submittedMessage: Message = await submittedByUser.send({ embeds: [embedMessage] });
	await submittedMessage.react('🔥');
	const completedMessage: Message = await completedByUser.send({ embeds: [embedMessage] });
	await addCompleteReactions(completedMessage, completedBounty);

	await updateMessageStore(completedBounty, submittedMessage, completedMessage);
};

export const addCompleteReactions = async (message: Message, bounty: BountyCollection): Promise<any> => {
	await message.react('🔥');
	if (!bounty.paidStatus || bounty.paidStatus === PaidStatus.unpaid) {
		await message.react('💰');
	}
};

// Save where we sent the Bounty message embeds for future updates
export const updateMessageStore = async (bounty: BountyCollection, submittedMessage: Message, completedMessage: Message): Promise<any> => {
    const db: Db = await MongoDbUtils.connect('bountyboard');
    const bountyCollection = db.collection('bounties');
    const writeResult: UpdateWriteOpResult = await bountyCollection.updateOne({ _id: bounty._id }, {
        $set: {
            claimantMessage: {
                messageId: submittedMessage.id,
                channelId: submittedMessage.channelId,
            },
            creatorMessage: {
                messageId: completedMessage.id,
                channelId: completedMessage.channelId,
            },
        },
        $unset: { discordMessageId: "" },
    });

    if (writeResult.result.ok !== 1) {
        Log.error('failed to update completed bounty with message Id');
        throw new Error(`Write to database for bounty ${bounty._id} failed. `);
    }

};
