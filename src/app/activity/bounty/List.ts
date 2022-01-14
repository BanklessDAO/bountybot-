import MongoDbUtils  from '../../utils/MongoDbUtils';
import { Cursor, Db } from 'mongodb';
import { Channel, GuildMember, MessageEmbedOptions, TextChannel } from 'discord.js';
import Log from '../../utils/Log';
import { Bounty } from '../../types/bounty/Bounty';
import DiscordUtils from '../../utils/DiscordUtils';
import ValidationError from '../../errors/ValidationError';
import { ListRequest } from '../../requests/ListRequest';
import { CustomerCollection } from '../../types/bounty/CustomerCollection';

const DB_RECORD_LIMIT = 10;

export const listBounty = async (request: ListRequest): Promise<any> => {
    const guildAndMember = await DiscordUtils.getGuildAndMember(request.commandContext.guildID, request.commandContext.user.id);
    const guildMember: GuildMember = guildAndMember.guildMember;
    const guildId: string = guildAndMember.guild.id;
    const listType: string = request.listType;

    let dbRecords: Cursor;
    // TODO: move to constants
	const db: Db = await MongoDbUtils.connect('bountyboard');
	const bountyCollection = db.collection('bounties');
    const customerCollection = db.collection('customers');

    const dbCustomerResult: CustomerCollection = await customerCollection.findOne({
        customerId: request.guildId,
    });

    const channel = await guildMember.guild.channels.fetch(dbCustomerResult.bountyChannel);
    const channelName = channel.name;


    Log.debug('Connected to database successfully.');
    Log.info('Bounty list type: ' + listType);

	switch (listType) { 
	case 'CREATED_BY_ME':
		dbRecords = bountyCollection.find({ 'createdBy.discordId': guildMember.user.id, status: { $ne: 'Deleted' }, 'customerId': guildId }).limit(DB_RECORD_LIMIT);
		break;
	case 'CLAIMED_BY_ME':
		dbRecords = bountyCollection.find({ 'claimedBy.discordId': guildMember.user.id, status: { $ne: 'Deleted' }, 'customerId': guildId }).limit(DB_RECORD_LIMIT);
		break;
    case 'CLAIMED_BY_ME_AND_COMPLETE':
        dbRecords = bountyCollection.find({ 'claimedBy.discordId': guildMember.user.id, status: 'Completed', 'customerId': guildId }).limit(DB_RECORD_LIMIT);
        break;
	case 'DRAFTED_BY_ME':
		dbRecords = bountyCollection.find({ 'createdBy.discordId': guildMember.user.id, status: 'Draft', 'customerId': guildId }).limit(DB_RECORD_LIMIT);
		break;
	case 'OPEN':
		dbRecords = bountyCollection.find({ status: 'Open', 'customerId': guildId }).limit(DB_RECORD_LIMIT);
		break;
	case 'IN_PROGRESS':
		dbRecords = bountyCollection.find({ status: 'In-Progress', 'customerId': guildId }).limit(DB_RECORD_LIMIT);
		break;
	}
	if (!(await dbRecords.hasNext())) {
		return await request.commandContext.send({ content: 'We couldn\'t find any bounties!' });
	}
	return await sendMultipleMessages(guildMember, dbRecords, guildId, channelName);
};

const sendMultipleMessages = async (guildMember: GuildMember, dbRecords: Cursor, guildId: string, bountyChannelName: string): Promise<any> => {
	const listOfBounties = [];
	while (listOfBounties.length < 10 && await dbRecords.hasNext()) {
		const record: Bounty = await dbRecords.next();
		const messageOptions: MessageEmbedOptions = await generateListEmbedMessage(record, record.status, guildId);
		listOfBounties.push(messageOptions);
	}
	await (guildMember.send({ embeds: listOfBounties }));
	return await guildMember.send({ content: `Please go to ${bountyChannelName} to take action.` });
};

export const generateListEmbedMessage = async (bountyRecord: Bounty, newStatus: string, guildID: string): Promise<MessageEmbedOptions> => {
	let messageEmbedOptions: MessageEmbedOptions = {
		color: 1998388,
		title: bountyRecord.title,
		url: (process.env.BOUNTY_BOARD_URL + bountyRecord._id.toHexString()),
		author: {
			iconURL: bountyRecord.createdBy.iconUrl,
			name: bountyRecord.createdBy.discordHandle,
		},
		description: bountyRecord.description,
		fields: [
			{ name: 'Bounty Id', value: bountyRecord._id.toHexString(), inline: false },
			{ name: 'Criteria', value: bountyRecord.criteria, inline: false },
			{ name: 'Reward', value: bountyRecord.reward.amount + ' ' + bountyRecord.reward.currency.toUpperCase(), inline: true },
			{ name: 'Status', value: newStatus, inline: true },
			{ name: 'Deadline', value: formatDisplayDate(bountyRecord.dueAt), inline: true },
			{ name: 'Created by', value: bountyRecord.createdBy.discordHandle, inline: true },
		],
		timestamp: new Date(bountyRecord.createdAt).getTime(),
	};

    if (bountyRecord.evergreen && bountyRecord.isParent) {
		messageEmbedOptions.fields.push(
			{ name: 'Evergreen (infinitely claimable)', value: 'Yes', inline: false })
	}

	if (bountyRecord.claimedBy !== undefined) {
		messageEmbedOptions.fields.push(
			{ name: 'Claimed by', value: bountyRecord.claimedBy.discordHandle, inline: false })
	}

	let isUser = true;
	let isRole = true;

	if(bountyRecord.gate) {
		try {
			const guildMember = await DiscordUtils.getGuildMemberFromUserId(bountyRecord.gate[0], guildID);
			messageEmbedOptions.fields.push(
				{ name: 'Gated to', value: guildMember.user.tag, inline: false })
		}
		catch (error) {
			isUser = false;
			Log.info(`Publishing: Gate ${bountyRecord.gate} is not a User`);
		}

		try {
			const role = await DiscordUtils.getRoleFromRoleId(bountyRecord.gate[0], guildID);
			messageEmbedOptions.fields.push({ name: 'Gated to', value: role.name, inline: false })
		}
		catch (error) {
			isRole = false;
			Log.info(`Publishing: Gate ${bountyRecord.gate} is not a Role`);
		}

		if(! (isUser || isRole) ) {
			Log.info(`Publishing bounty failed. Not gated to user or role`)
			throw new ValidationError('Please gate this bounty to a user or role.');
		}
	}

	return messageEmbedOptions;
};

// TODO: shared function
export const formatDisplayDate = (dateIso: string): string => {
    const options: Intl.DateTimeFormatOptions = {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    };
    return (new Date(dateIso)).toLocaleString('en-US', options);
}