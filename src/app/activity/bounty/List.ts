import MongoDbUtils  from '../../utils/MongoDbUtils';
import { Cursor, Db } from 'mongodb';
import { GuildMember, MessageEmbedOptions, Role } from 'discord.js';
import Log, { LogUtils } from '../../utils/Log';
import { Bounty } from '../../types/bounty/Bounty';
import DiscordUtils from '../../utils/DiscordUtils';
import { ListRequest } from '../../requests/ListRequest';
import { CustomerCollection } from '../../types/bounty/CustomerCollection';
import { BountyStatus } from '../../constants/bountyStatus';
import BountyUtils from '../../utils/BountyUtils';

const DB_RECORD_LIMIT = 10;

export const listBounty = async (request: ListRequest): Promise<any> => {
    const listUser = await DiscordUtils.getGuildMemberFromUserId(request.userId, request.guildId)
    const listType: string = request.listType;

    let dbRecords: Cursor;
    // TODO: move to constants
	const db: Db = await MongoDbUtils.connect('bountyboard');
	const bountyCollection = db.collection('bounties');
    const customerCollection = db.collection('customers');

    const dbCustomerResult: CustomerCollection = await customerCollection.findOne({
        customerId: request.guildId,
    });

    const channel = await listUser.guild.channels.fetch(dbCustomerResult.bountyChannel);
    const channelName = channel.name;


    Log.debug('Connected to database successfully.');
    Log.info('Bounty list type: ' + listType);

	switch (listType) { 
	case 'CREATED_BY_ME':
		dbRecords = bountyCollection.find({ 'createdBy.discordId': listUser.user.id, status: { $ne: 'Deleted' }, 'customerId': request.guildId }).limit(DB_RECORD_LIMIT);
		break;
	case 'CLAIMED_BY_ME':
		dbRecords = bountyCollection.find({ 'claimedBy.discordId': listUser.user.id, status: { $ne: 'Deleted' }, 'customerId': request.guildId }).limit(DB_RECORD_LIMIT);
		break;
    case 'CLAIMED_BY_ME_AND_COMPLETE':
        dbRecords = bountyCollection.find({ 'claimedBy.discordId': listUser.user.id, status: 'Completed', 'customerId': request.guildId }).limit(DB_RECORD_LIMIT);
        break;
	case 'DRAFTED_BY_ME':
		dbRecords = bountyCollection.find({ 'createdBy.discordId': listUser.user.id, status: 'Draft', 'customerId': request.guildId }).limit(DB_RECORD_LIMIT);
		break;
	case 'OPEN':
		dbRecords = bountyCollection.find({ status: BountyStatus.open, 'customerId': request.guildId }).limit(DB_RECORD_LIMIT);
		break;
	case 'IN_PROGRESS':
		dbRecords = bountyCollection.find({ status: BountyStatus.in_progress, 'customerId': request.guildId }).limit(DB_RECORD_LIMIT);
		break;
	}
	if (!(await dbRecords.hasNext())) {
		return await listUser.send({ content: 'We couldn\'t find any bounties!' });
	}
	return await sendMultipleMessages(listUser, dbRecords, request.guildId, channelName);
};

const sendMultipleMessages = async (listUser: GuildMember, dbRecords: Cursor, guildId: string, bountyChannelName: string): Promise<any> => {
	const listOfBounties = [];
	while (listOfBounties.length < 10 && await dbRecords.hasNext()) {
		const record: Bounty = await dbRecords.next();
		const messageOptions: MessageEmbedOptions = await generateListEmbedMessage(record, record.status, guildId);
		listOfBounties.push(messageOptions);
	}
	await (listUser.send({ embeds: listOfBounties }));
	return await listUser.send({ content: `Please go to ${bountyChannelName} or your DMs to take action.` });
};

export const generateListEmbedMessage = async (bountyRecord: Bounty, newStatus: string, guildID: string): Promise<MessageEmbedOptions> => {
	let messageEmbedOptions: MessageEmbedOptions = {
		color: 1998388,
		title: BountyUtils.createPublicTitle(bountyRecord),
		url: (process.env.BOUNTY_BOARD_URL + bountyRecord._id.toHexString()),
		author: {
			iconURL: bountyRecord.createdBy.iconUrl,
			name: bountyRecord.createdBy.discordHandle,
		},
		description: bountyRecord.description,
        // static bountyId = 0;
        // static criteria = 1;
        // static reward = 2;
        // static status = 3;
        // static deadline = 4;
        // static createdBy = 5;
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

	if (bountyRecord.claimedBy !== undefined) {
		messageEmbedOptions.fields.push(
			{ name: 'Claimed by', value: bountyRecord.claimedBy.discordHandle, inline: false })
	}

    let role: Role;
	if(bountyRecord.gate) {
		try {
			role = await DiscordUtils.getRoleFromRoleId(bountyRecord.gate[0], guildID);
            messageEmbedOptions.fields.push({ name: 'Gated to', value: role.name, inline: false })
		}
		catch (error) {
			LogUtils.logError(`Failed to fetch role for roleId ${bountyRecord.gate[0]}`, error, bountyRecord.customerId)
		}
	}
    
	return messageEmbedOptions;
};

export const formatDisplayDate = (dateIso: string): string => {
    const options: Intl.DateTimeFormatOptions = {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    };
    return (new Date(dateIso)).toLocaleString('en-US', options);
}