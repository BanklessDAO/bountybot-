import { CommandContext } from 'slash-create'
import { GuildMember, TextChannel, Message, MessageEmbedOptions } from 'discord.js'
import Log from '../../utils/Log';
import mongo, { Db, UpdateWriteOpResult } from 'mongodb';
import MongoDbUtils from '../../utils/MongoDbUtils';
import { BountyCollection } from '../../types/bounty/BountyCollection';
import { Bounty } from '../../types/bounty/Bounty';
import { CustomerCollection } from '../../types/bounty/CustomerCollection';
import DiscordUtils from '../../utils/DiscordUtils';
import BountyUtils from '../../utils/BountyUtils';
import { PublishRequest } from '../../requests/PublishRequest';
import { BountyStatus } from '../../constants/bountyStatus';

export const publishBounty = async (publishRequest: PublishRequest): Promise<any> => {
    Log.info(`starting to finalize bounty: ${publishRequest.bountyId} from guild: ${publishRequest.guildId}`);
    const bountyId = publishRequest.bountyId;
    const guildId = publishRequest.guildId;
    const { guildMember } = await DiscordUtils.getGuildAndMember(publishRequest.guildId, publishRequest.userId);

    const [dbBountyResult, dbCustomerResult] = await getDbHandler(bountyId, guildId);
	const messageOptions: MessageEmbedOptions = await generateEmbedMessage(dbBountyResult, 'Open', guildId);

	const bountyChannel: TextChannel = await guildMember.guild.channels.fetch(dbCustomerResult.bountyChannel) as TextChannel;
	const bountyMessage: Message = await bountyChannel.send({ embeds: [messageOptions] });
	Log.info('bounty published to #bounty-board');
	addPublishReactions(bountyMessage);

    await writeDbHandler(dbBountyResult, bountyMessage.id);

    await guildMember.send({ content: `Bounty published to #🧀-bounty-board and the website! ${process.env.BOUNTY_BOARD_URL}${bountyId}` });
	
	return;
}

const getDbHandler = async (bountyId: string, guildId: string): Promise<[BountyCollection, CustomerCollection]> => {
    Log.debug(`Entered get DbHandler for publish`);
    const db: Db = await MongoDbUtils.connect('bountyboard');
	const dbCollectionBounties = db.collection('bounties');
    const dbCollectionCustomers = db.collection('customers');
    const dbCustomerResult: CustomerCollection = await dbCollectionCustomers.findOne({
		customerId: guildId
	});
    const dbBountyResult: BountyCollection = await dbCollectionBounties.findOne({
		_id: new mongo.ObjectId(bountyId),
		status: 'Draft',
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
			discordMessageId: bountyMessageId,
		},
		$push: {
			statusHistory: {
				status: BountyStatus.open,
				setAt: currentDate,
			},
		},
	});

	if (writeResult.modifiedCount != 1) {
		Log.info(`failed to update record ${dbBountyResult._id} for user <@${dbBountyResult.createdBy.discordId}>`);
		throw new Error('Sorry something is not working, our devs are looking into it.' );
	}

}

export const addPublishReactions = (message: Message): void => {
	message.reactions.removeAll();
	message.react('🏴');
	//message.react('🔄');
	//message.react('📝');
	message.react('❌');
};

export const generateEmbedMessage = async (dbBounty: BountyCollection, newStatus: string, guildID: string): Promise<MessageEmbedOptions> => {

	let messageEmbedOptions: MessageEmbedOptions = {
		color: 1998388,
		title: BountyUtils.createPublicTitle(<Bounty>dbBounty),
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
			text: '🏴 - claim | ❌ - delete',
		},
	};

	if(dbBounty.gate) {
			const role = await DiscordUtils.getRoleFromRoleId(dbBounty.gate[0], guildID);
			messageEmbedOptions.fields.push({ name: 'Gated to', value: role.name, inline: false })
    }

	return messageEmbedOptions;
};