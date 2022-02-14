import MongoDbUtils  from '../../utils/MongoDbUtils';
import { Cursor, Db } from 'mongodb';
import { Message, GuildMember, MessageEmbedOptions, Role } from 'discord.js';
import Log, { LogUtils } from '../../utils/Log';
import { Bounty } from '../../types/bounty/Bounty';
import DiscordUtils from '../../utils/DiscordUtils';
import { ListRequest } from '../../requests/ListRequest';
import { CustomerCollection } from '../../types/bounty/CustomerCollection';
import { BountyStatus } from '../../constants/bountyStatus';
import BountyUtils from '../../utils/BountyUtils';
import { PaidStatus } from '../../constants/paidStatus';

const DB_RECORD_LIMIT = 10;

export const listBounty = async (request: ListRequest): Promise<any> => {
	Log.debug('In List activity');

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

	let IOUList: boolean = false;

	switch (listType) { 
	case 'CREATED_BY_ME':
		dbRecords = bountyCollection.find({ 'createdBy.discordId': listUser.user.id, isIOU: { $ne: true }, status: { $ne: 'Deleted' }, 'customerId': request.guildId }).limit(DB_RECORD_LIMIT);
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
		dbRecords = bountyCollection.find({ status: BountyStatus.open, isIOU: { $ne: true }, 'customerId': request.guildId }).limit(DB_RECORD_LIMIT);
		break;
	case 'IN_PROGRESS':
		dbRecords = bountyCollection.find({ status: BountyStatus.in_progress, 'customerId': request.guildId }).limit(DB_RECORD_LIMIT);
		break;
	case 'PAID_BY_ME':
		dbRecords = bountyCollection.find({ 'createdBy.discordId': listUser.user.id, status: BountyStatus.complete, isIOU: true, 'customerId': request.guildId }).limit(DB_RECORD_LIMIT);
		IOUList = true;
		break;
	case 'UNPAID_BY_ME':
		dbRecords = bountyCollection.find({ 'createdBy.discordId': listUser.user.id, status: BountyStatus.open, isIOU: true, 'customerId': request.guildId }).limit(DB_RECORD_LIMIT);
		IOUList = true;
		break;
	}
	if (!(await dbRecords.hasNext())) {
		return await listUser.send({ content: 'We couldn\'t find any bounties!' });
	}
	return await sendMultipleMessages(listUser, dbRecords, request.guildId, channelName, IOUList);
};

const sendMultipleMessages = async (listUser: GuildMember, dbRecords: Cursor, guildId: string, bountyChannelName: string, IOUList: boolean): Promise<any> => {
	if (IOUList) {
		while (await dbRecords.hasNext()) {
			const record: Bounty = await dbRecords.next();
			const messageOptions: MessageEmbedOptions = await generateListEmbedMessage(record, record.paidStatus, guildId);
			if (record.paidStatus == PaidStatus.unpaid) {
				messageOptions.footer = {
					text: '💰 - paid | ❌ - delete ',
				};
			}
			const message: Message = await (listUser.send( { embeds: [messageOptions] } ));
			if (record.paidStatus == PaidStatus.unpaid) {
				await message.react('💰');
				await message.react('❌');
			}
		}
	} else {
		const listOfBounties = [];
		while (listOfBounties.length < 10 && await dbRecords.hasNext()) {
			const record: Bounty = await dbRecords.next();
			const messageOptions: MessageEmbedOptions = await generateListEmbedMessage(record, record.status, guildId);
			listOfBounties.push(messageOptions);
		}
		await (listUser.send({ embeds: listOfBounties }));
		await listUser.send({ content: `Please go to ${bountyChannelName} or your DMs to take action.` });
	}
};

export const generateListEmbedMessage = async (bountyRecord: Bounty, newStatus: string, guildID: string): Promise<MessageEmbedOptions> => {
	let fields = [];
	if (bountyRecord.isIOU) {
		fields = [
			{ name: 'Bounty Id', value: bountyRecord._id.toHexString(), inline: false },
			{ name: 'Reward', value: bountyRecord.reward.amount + ' ' + bountyRecord.reward.currency.toUpperCase(), inline: true },
			{ name: 'Status', value: newStatus, inline: true },
		]

	} else {	
		fields = [
			{ name: 'Bounty Id', value: bountyRecord._id.toHexString(), inline: false },
			{ name: 'Criteria', value: bountyRecord.criteria, inline: false },
			{ name: 'Reward', value: bountyRecord.reward.amount + ' ' + bountyRecord.reward.currency.toUpperCase(), inline: true },
			{ name: 'Status', value: newStatus, inline: true },
			{ name: 'Deadline', value: formatDisplayDate(bountyRecord.dueAt), inline: true },
			{ name: 'Created by', value: bountyRecord.createdBy.discordHandle, inline: true },
		]
	}

	if (bountyRecord.resolutionNote) {
		fields.push({ name: 'Notes', value: bountyRecord.resolutionNote, inline: false });
	}

	let messageEmbedOptions: MessageEmbedOptions = {
		color: 1998388,
		title: await BountyUtils.createPublicTitle(bountyRecord),
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
		fields: fields,
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