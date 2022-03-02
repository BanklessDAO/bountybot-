import { PaidRequest } from '../../requests/PaidRequest';
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


export const paidBounty = async (request: PaidRequest): Promise<void> => {
	Log.debug('In Paid activity');

    const getDbResult: {dbBountyResult: BountyCollection, bountyChannel: string} = await getDbHandler(request);
	// Since we are in DMs with new flow, guild might not be populated in the request
	if (request.guildId === undefined || request.guildId === null) {
		request.guildId = getDbResult.dbBountyResult.customerId;
	}
    const paidByUser = await DiscordUtils.getGuildMemberFromUserId(request.userId, request.guildId);
	Log.info(`${request.bountyId} IOU paid by ${paidByUser.user.tag}`);
	
    await writeDbHandler(request, paidByUser);

	let payerMessage: Message;
	let channelId: string;
	let messageId: string;

	if (!request.message) {
		// If we put the bounty in a DM using the new flow, find it. If not, find it in the bounty board channel (might not be needed,
		// but leaving for future use with web campatibility)

		if (getDbResult.dbBountyResult.creatorMessage !== undefined) {
			channelId = getDbResult.dbBountyResult.creatorMessage.channelId;
			messageId = getDbResult.dbBountyResult.creatorMessage.messageId;
		} else {
			channelId = getDbResult.bountyChannel;
			messageId = getDbResult.dbBountyResult.discordMessageId;
		}
		const bountyChannel = await paidByUser.client.channels.fetch(channelId) as TextChannel;
		payerMessage = await bountyChannel.messages.fetch(messageId).catch(e => {
			LogUtils.logError(`could not find IOU ${request.bountyId} in channel ${channelId} in guild ${request.guildId}`, e);
			throw new RuntimeError(e);
		});
    } else {
        payerMessage = request.message;
    }

	const bountyUrl = process.env.BOUNTY_BOARD_URL + request.bountyId;
	const owedToUser: GuildMember = await paidByUser.guild.members.fetch(getDbResult.dbBountyResult.owedTo.discordId);

    
    await paidBountyMessage(getDbResult.dbBountyResult, payerMessage, paidByUser, owedToUser);
	
	const creatorPaidDM = 
        `Thank you for marking your IOU as paid <${bountyUrl}>\n` +
        `If you haven't already, please remember to tip <@${owedToUser.id}>`;

    
    await paidByUser.send({ content: creatorPaidDM });
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
		status: BountyStatus.open,
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
		status: BountyStatus.open,
	});

	const currentDate = (new Date()).toISOString();
	const writeResult: UpdateWriteOpResult = await bountyCollection.updateOne(dbBountyResult, {
		$set: {
			reviewedBy: {
				discordHandle: paidByUser.user.tag,
				discordId: paidByUser.user.id,
				iconUrl: paidByUser.user.avatarURL(),
			},
            // TO-DO: What is the point of status history if we publish createdAt, claimedAt... as first class fields?
            // note that createdAt, claimedAt are not part of the BountyCollection type
			reviewedAt: currentDate,
			status: BountyStatus.complete,
			paidStatus: PaidStatus.paid,
			resolutionNote: request.resolutionNote
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
        throw new Error(`Write to database for IOU ${request.bountyId} failed for Paid `);
    }
}

export const paidBountyMessage = async (paidBounty: BountyCollection, payerMessage: Message, paidByUser: GuildMember, submittedByUser: GuildMember): Promise<any> => {
	Log.debug('fetching bounty message for paid')

	let embedMessage: MessageEmbed = new MessageEmbed(payerMessage.embeds[0]);
	
	await payerMessage.delete();
	// TODO: Figure out better way to find fields to modify
	embedMessage.fields[2].value = PaidStatus.paid;
	embedMessage.setColor('#01d212');
	embedMessage.addField('Paid by', paidByUser.user.tag, true);
	if (paidBounty.resolutionNote) {
		embedMessage.addField('Notes', paidBounty.resolutionNote, false);
	}
	embedMessage.setFooter({text: ''});

	const paidMessage: Message = await paidByUser.send({ embeds: [embedMessage] });
	await addPaidReactions(paidMessage);

	await updateMessageStore(paidBounty, paidMessage);
};

export const addPaidReactions = async (message: Message): Promise<any> => {
	await message.react('🔥');
};

// Save where we sent the Bounty message embeds for future updates
export const updateMessageStore = async (bounty: BountyCollection, paidMessage: Message): Promise<any> => {
    const db: Db = await MongoDbUtils.connect('bountyboard');
    const bountyCollection = db.collection('bounties');
    const writeResult: UpdateWriteOpResult = await bountyCollection.updateOne({ _id: bounty._id }, {
        $set: {
            creatorMessage: {
                messageId: paidMessage.id,
                channelId: paidMessage.channelId,
            },
        },
        $unset: { discordMessageId: "" },
    });

    if (writeResult.result.ok !== 1) {
        Log.error('failed to update paid IOU with message Id');
        throw new Error(`Write to database for IOU ${bounty._id} failed. `);
    }

};
