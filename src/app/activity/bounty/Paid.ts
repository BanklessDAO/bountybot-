import { PaidRequest } from '../../requests/PaidRequest';
import DiscordUtils from '../../utils/DiscordUtils';
import Log, { LogUtils } from '../../utils/Log';
import { GuildMember, MessageEmbed, Message, TextChannel, Collection, MessageReaction } from 'discord.js';
import MongoDbUtils from '../../utils/MongoDbUtils';
import mongo, { Db, UpdateWriteOpResult } from 'mongodb';
import { BountyCollection } from '../../types/bounty/BountyCollection';
import { CustomerCollection } from '../../types/bounty/CustomerCollection';
import RuntimeError from '../../errors/RuntimeError';
import { BountyStatus } from '../../constants/bountyStatus';
import { BountyEmbedFields, IOUEmbedFields } from '../../constants/embeds';
import { PaidStatus } from '../../constants/paidStatus';


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
	const owedToDiscordId = getDbResult.dbBountyResult.isIOU ? 
		getDbResult.dbBountyResult.owedTo.discordId :
		getDbResult.dbBountyResult.claimedBy.discordId;
	const owedToUser: GuildMember = await paidByUser.guild.members.fetch(owedToDiscordId);

    
    await paidBountyMessage(getDbResult.dbBountyResult, payerMessage, paidByUser, owedToUser);
	
	const creatorPaidDM = 
        `Thank you for marking your bounty as paid <${bountyUrl}>\n` +
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
	if (dbBountyResult.isIOU) {
		writeObject.$set.addField({
			status: BountyStatus.complete,
			reviewedBy: {
				discordHandle: paidByUser.user.tag,
				discordId: paidByUser.user.id,
				iconUrl: paidByUser.user.avatarURL(),
			}
		})
		writeObject.$push = {
			statusHistory: {
				status: BountyStatus.complete,
				setAt: currentDate,
			},
		}
	}
	const writeResult: UpdateWriteOpResult = await bountyCollection.updateOne(dbBountyResult, writeObject);

    if (writeResult.result.ok !== 1) {
        Log.error(`Write result did not execute correctly`);
        throw new Error(`Write to database for bounty ${request.bountyId} failed for Paid `);
    }
}

export const paidBountyMessage = async (paidBounty: BountyCollection, payerMessage: Message, paidByUser: GuildMember, submittedByUser: GuildMember): Promise<any> => {
	Log.debug('fetching bounty message for paid')

	let embedMessage: MessageEmbed = new MessageEmbed(payerMessage.embeds[0]);
	let reactions = payerMessage.reactions.cache;
	let reactionFooterText = '';
	await payerMessage.delete();
	// TODO: Figure out better way to find fields to modify
	if (paidBounty.isIOU) {
		embedMessage.fields[IOUEmbedFields.paidStatus].value = PaidStatus.paid;
	} else {
		embedMessage.addField('Paid Status', 'Paid', false);
		if (paidBounty.status !== BountyStatus.complete) {
			reactionFooterText = '✅ - complete';
		}
		else {
			reactionFooterText = 'Bounty Complete and Paid. No futher action required.'
		}
	}
	embedMessage.setColor('#01d212');
	embedMessage.addField('Paid by', paidByUser.user.tag, true);
	if (paidBounty.resolutionNote) {
		embedMessage.addField('Notes', paidBounty.resolutionNote, false);
	}

	embedMessage.setFooter({text: reactionFooterText});

	const paidMessage: Message = await paidByUser.send({ embeds: [embedMessage] });
	await addPaidReactions(paidMessage, paidBounty, reactions);

	await updateMessageStore(paidBounty, paidMessage);
};

export const addPaidReactions = async (message: Message, bounty: BountyCollection, previousReactions: Collection<String, MessageReaction>): Promise<any> => {
	if (bounty.isIOU) {
		await message.react('🔥');
	}
	else {
		for (const [key, value] of previousReactions) {
			if (value.me && value.emoji.name !== '💰') {
				await message.react(value.emoji.name);
			}
		}
	}
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
        Log.error('failed to update paid bounty with message Id');
        throw new Error(`Write to database for bounty ${bounty._id} failed. `);
    }

};
