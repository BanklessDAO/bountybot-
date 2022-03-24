import { TextChannel, Message, MessageEmbedOptions } from 'discord.js'
import Log, { LogUtils } from '../../utils/Log';
import mongo, { Db, UpdateWriteOpResult } from 'mongodb';
import MongoDbUtils from '../../utils/MongoDbUtils';
import { BountyCollection } from '../../types/bounty/BountyCollection';
import { Bounty } from '../../types/bounty/Bounty';
import { CustomerCollection } from '../../types/bounty/CustomerCollection';
import DiscordUtils from '../../utils/DiscordUtils';
import BountyUtils from '../../utils/BountyUtils';
import RuntimeError from '../../errors/RuntimeError';
import { PublishRequest } from '../../requests/PublishRequest';
import { BountyStatus } from '../../constants/bountyStatus';
import { Activities } from '../../constants/activities';
import { Clients } from '../../constants/clients';

export const publishBounty = async (publishRequest: PublishRequest): Promise<any> => {
	Log.debug('In Publish activity');

    Log.info(`starting to finalize bounty: ${publishRequest.bountyId} from guild: ${publishRequest.guildId}`);
    const bountyId = publishRequest.bountyId;
    const guildId = publishRequest.guildId;
    const { guildMember } = await DiscordUtils.getGuildAndMember(publishRequest.guildId, publishRequest.userId);

    const [dbBountyResult, dbCustomerResult] = await getDbHandler(bountyId, guildId, publishRequest);

	const messageOptions: MessageEmbedOptions = await generateEmbedMessage(dbBountyResult, BountyStatus.open, guildId);

	const bountyChannel: TextChannel = await guildMember.client.channels.fetch(dbCustomerResult.bountyChannel) as TextChannel;
	const bountyMessage: Message = await bountyChannel.send({ embeds: [messageOptions] });
	Log.info(`bounty published to ${bountyChannel.name}`);
	addPublishReactions(bountyMessage, dbBountyResult.requireApplication);

    if (!publishRequest.clientSyncRequest) {
		await writeDbHandler(dbBountyResult, bountyMessage.id);
	}

    await guildMember.send({ content: `Bounty published to ${bountyChannel.name} and the website! <${process.env.BOUNTY_BOARD_URL}${bountyId}>` });

	// Remove old publish preview
	if (dbBountyResult.creatorMessage !== undefined) {
		const dmChannel = await guildMember.client.channels.fetch(dbBountyResult.creatorMessage.channelId) as TextChannel;
		const previewMessage = await dmChannel.messages.fetch(dbBountyResult.creatorMessage.messageId).catch(e => {
			LogUtils.logError(`could not find bounty ${dbBountyResult._id} in channel ${dmChannel.id} in guild ${guildId}`, e);
			throw new RuntimeError(e);
		});
		await previewMessage.delete();
	}

	await updateMessageStore(dbBountyResult, bountyMessage);
	
	return;
}

const getDbHandler = async (bountyId: string, guildId: string, request: PublishRequest): Promise<[BountyCollection, CustomerCollection]> => {
    Log.debug(`Entered get DbHandler for publish`);
    const db: Db = await MongoDbUtils.connect('bountyboard');
	const dbCollectionBounties = db.collection('bounties');
    const dbCollectionCustomers = db.collection('customers');

	const status = request.clientSyncRequest ? 'Open' : 'Draft';

    const dbCustomerResult: CustomerCollection = await dbCollectionCustomers.findOne({
		customerId: guildId
	});
    const dbBountyResult: BountyCollection = await dbCollectionBounties.findOne({
		_id: new mongo.ObjectId(bountyId),
		status: status,
	});

    return [dbBountyResult, dbCustomerResult];

}

const writeDbHandler = async (dbBountyResult: BountyCollection, bountyMessageId: string): Promise<any> => {
    const db: Db = await MongoDbUtils.connect('bountyboard');
	const dbCollectionBounties = db.collection('bounties');
    const currentDate = (new Date()).toISOString();
	const writeResult: UpdateWriteOpResult = await dbCollectionBounties.updateOne(dbBountyResult, {
		$set: {
			status: BountyStatus.open,
		},
		$unset: { creatorMessage: "" } ,
		$push: {
			statusHistory: {
				status: BountyStatus.open,
				setAt: currentDate,
			},
			activityHistory: {
				activity: Activities.publish,
				modifiedAt: currentDate,
				client: Clients.bountybot,
			}
		},
	});

	if (writeResult.modifiedCount != 1) {
		Log.info(`failed to update record ${dbBountyResult._id} for user <@${dbBountyResult.createdBy.discordId}>`);
		throw new Error('Sorry something is not working, our devs are looking into it.' );
	}

}

export const addPublishReactions = async (message: Message, requireApplication: boolean): Promise<any> => {
	await message.reactions.removeAll();
	if (requireApplication) {
		await message.react('🙋');
	} else {
		await message.react('🏴');
	}
	message.react('❌');
};

export const generateEmbedMessage = async (dbBounty: BountyCollection, newStatus: string, guildID: string): Promise<MessageEmbedOptions> => {

	let footer = dbBounty.requireApplication ? '🙋 - apply | ❌ - delete' : '🏴 - claim | ❌ - delete';
	let messageEmbedOptions: MessageEmbedOptions = {
		color: 1998388,
		title: await BountyUtils.createPublicTitle(<Bounty>dbBounty),
		url: (process.env.BOUNTY_BOARD_URL + dbBounty._id.toHexString()),
		author: {
			iconURL: dbBounty.createdBy.iconUrl,
			name: dbBounty.createdBy.discordHandle,
		},
		description: dbBounty.description,
		fields: [
			{ name: 'Bounty Id', value: dbBounty._id.toHexString(), inline: false },
			{ name: 'Criteria', value: dbBounty.criteria, inline: false },
			{ name: 'Reward', value: dbBounty.reward.amount + ' ' + dbBounty.reward.currency.toUpperCase(), inline: true },
			{ name: 'Status', value: newStatus, inline: true },
			{ name: 'Deadline', value: BountyUtils.formatDisplayDate(dbBounty.dueAt), inline: true },
			{ name: 'Created by', value: dbBounty.createdBy.discordHandle, inline: true },
		],
		timestamp: new Date().getTime(),
		footer: {
			text: footer,
		},
	};

	if (dbBounty.gate) {
		const role = await DiscordUtils.getRoleFromRoleId(dbBounty.gate[0], guildID);
		messageEmbedOptions.fields.push({ name: 'For role', value: role.name, inline: false })
    }

	if (dbBounty.assign) {
		const assignedUser = await DiscordUtils.getGuildMemberFromUserId(dbBounty.assign, guildID);
		messageEmbedOptions.fields.push({ name: 'For user', value: assignedUser.user.tag, inline: false })
	}

	return messageEmbedOptions;
};

export const updateMessageStore = async (bounty: BountyCollection, card: Message): Promise<any> => {
	const db: Db = await MongoDbUtils.connect('bountyboard');
	const dbCollectionBounties = db.collection('bounties');

	const writeResult: UpdateWriteOpResult = await dbCollectionBounties.updateOne(
		{_id: new mongo.ObjectId(bounty._id)}, {
		$set: {
			discordMessageId: card.id,
		},
	});

	if (writeResult.result.ok !== 1) {
        Log.error(`failed to update publish bounty with message Id ${card.id}`);
        throw new Error(`Write to database for bounty ${bounty._id} failed. `);
    }
}