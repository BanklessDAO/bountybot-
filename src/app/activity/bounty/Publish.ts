import { CommandContext } from 'slash-create'
import { GuildMember, TextChannel, Message, MessageEmbedOptions } from 'discord.js'
import Log from '../../utils/Log';
import mongo, { Db, UpdateWriteOpResult } from 'mongodb';
import MongoDbUtils from '../../utils/MongoDbUtils';
import { BountyCollection } from '../../types/BountyCollection';
import { CustomerCollection } from '../../types/CustomerCollection';
import ValidationError from '../../errors/ValidationError';
import DiscordUtils from '../../utils/DiscordUtils';
import BountyUtils from '../../utils/BountyUtils';

const Publish =  async (commandContext: CommandContext): Promise<any> => {
    const { guildMember } = await DiscordUtils.getGuildAndMember(commandContext);
    await finalizeBounty(guildMember, commandContext.options.publish['bounty-id'], commandContext.guildID);
}

export const finalizeBounty = async (guildMember: GuildMember, bountyId: string, guildId: string) => {
    Log.info('starting to finalize bounty: ' + bountyId);

    const [dbBountyResult, dbCustomerResult] = await getDbHandler(bountyId, guildId);
	const messageOptions: MessageEmbedOptions = await generateEmbedMessage(dbBountyResult, 'Open', guildId);

	const bountyChannel: TextChannel = await guildMember.guild.channels.fetch(dbCustomerResult.bountyChannel) as TextChannel;
	const bountyMessage: Message = await bountyChannel.send({ embeds: [messageOptions] });
	Log.info('bounty published to #bounty-board');
	addPublishReactions(bountyMessage);

    await writeDbHandler(dbBountyResult, bountyMessage.id);

	
	return guildMember.send({ content: `Bounty published to #🧀-bounty-board and the website! ${process.env.BOUNTY_BOARD_URL}${bountyId}` });
}

const getDbHandler = async (bountyId: string, guildId: string): Promise<[BountyCollection, CustomerCollection]> => {
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

    if (dbBountyResult.status != 'Draft') {
		Log.info(`${bountyId} bounty is not drafted`);
		throw new ValidationError('The bounty you selected is not a draft. Only draft bounties can be published.');
	}

    return [dbBountyResult, dbCustomerResult];

}

const writeDbHandler = async (dbBountyResult: BountyCollection, bountyMessageId: string): Promise<any> => {
    const db: Db = await MongoDbUtils.connect('bountyboard');
	const dbCollectionBounties = db.collection('bounties');
    const currentDate = (new Date()).toISOString();
	const writeResult: UpdateWriteOpResult = await dbCollectionBounties.updateOne(dbBountyResult, {
		$set: {
			status: 'Open',
			discordMessageId: bountyMessageId,
		},
		$push: {
			statusHistory: {
				status: 'Open',
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
		title: dbBounty.title,
		url: (process.env.BOUNTY_BOARD_URL + dbBounty._id.toHexString()),
		author: {
			iconURL: dbBounty.createdBy.iconUrl,
			name: dbBounty.createdBy.discordHandle,
		},
		description: dbBounty.description,
		fields: [
			{ name: 'HashId', value: dbBounty._id.toHexString(), inline: false },
			{ name: 'Criteria', value: dbBounty.criteria, inline: false },
			{ name: 'Reward', value: dbBounty.reward.amount + ' ' + dbBounty.reward.currency.toUpperCase(), inline: true },
			{ name: 'Status', value: newStatus, inline: true },
			{ name: 'Deadline', value: BountyUtils.formatDisplayDate(dbBounty.dueAt), inline: true },
			{ name: 'Created by', value: dbBounty.createdBy.discordHandle, inline: true },
		],
		timestamp: new Date().getTime(),
		// footer: {
		// 	text: '🏴 - claim | 🔄 - refresh | 📝 - edit | ❌ - delete',
		// },
		footer: {
			text: '🏴 - claim | 🔄 - refresh | ❌ - delete',
		},
	};

	let isUser = true;
	let isRole = true;

	if(dbBounty.gate) {
			const role = await DiscordUtils.getRoleFromRoleId(dbBounty.gate[0], guildID);
			messageEmbedOptions.fields.push({ name: 'Gated to', value: role.name, inline: false })
    }

	return messageEmbedOptions;
};


export default Publish;