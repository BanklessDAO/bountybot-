import MongoDbUtils  from '../../utils/MongoDbUtils';
import { Cursor, Db } from 'mongodb';
import { TextChannel, Message, GuildMember, MessageEmbedOptions, Role } from 'discord.js';
import Log, { LogUtils } from '../../utils/Log';
import { BountyCollection } from '../../types/bounty/BountyCollection';
import DiscordUtils from '../../utils/DiscordUtils';
import { ListRequest } from '../../requests/ListRequest';
import { CustomerCollection } from '../../types/bounty/CustomerCollection';
import { BountyStatus } from '../../constants/bountyStatus';
import BountyUtils from '../../utils/BountyUtils';
import { PaidStatus } from '../../constants/paidStatus';

const DB_RECORD_LIMIT = 25;

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

	// To DO - get channel where command was done.
    const channel: TextChannel = await DiscordUtils.getTextChannelfromChannelId(dbCustomerResult.bountyChannel);
    const channelName = channel.name;


    Log.debug('Connected to database successfully.');
    Log.info('Bounty list type: ' + listType);

	let IOUList: boolean = false;
	let listTitle: string;

	switch (listType) { 
	case 'CREATED_BY_ME':
		dbRecords = bountyCollection.find({ 'createdBy.discordId': listUser.user.id, isIOU: { $ne: true }, status: { $ne: 'Deleted' }, 'customerId': request.guildId }).sort({ status: -1, createdAt: -1 });
		listTitle = "Bounties created by me";
		break;
	case 'CLAIMED_BY_ME':
		dbRecords = bountyCollection.find({ 'claimedBy.discordId': listUser.user.id, status: { $ne: 'Deleted' }, 'customerId': request.guildId }).sort({ status: -1, createdAt: -1 });
		listTitle = "Bounties claimed by me";
		break;
	default: 
		dbRecords = bountyCollection.find({ $or: [ { status: BountyStatus.open } , { status: BountyStatus.in_progress } ], isIOU: { $ne: true }, 'customerId': request.guildId }).sort({ status: -1, createdAt: -1 });
		listTitle =  "Active bounties";
	}
	if (!(await dbRecords.hasNext())) {
		return await listUser.send({ content: 'We couldn\'t find any bounties!' });
	}

	if (IOUList) {
		while (await dbRecords.hasNext()) {
			const record: BountyCollection = await dbRecords.next();
			const messageOptions: MessageEmbedOptions = await generateListEmbedMessage(record, record.paidStatus, request.guildId);
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
		const listOfBounties: MessageEmbedOptions = {
			title: listTitle,
			url: process.env.BOUNTY_BOARD_URL,
			color: 1998388,
			fields: []
		};
		let listCount = 0;
		let moreRecords = true;
		while (listCount < DB_RECORD_LIMIT && moreRecords) {
			let segmentCount = 0;
			let listString = "";
			while ((listCount < DB_RECORD_LIMIT) && (segmentCount < 5) && moreRecords) {
				const record: BountyCollection = await dbRecords.next();
				let cardMessage: Message;
				if (record.canonicalCard !== undefined) {  
					cardMessage = await DiscordUtils.getMessagefromMessageId(record.canonicalCard.messageId, await DiscordUtils.getTextChannelfromChannelId(record.canonicalCard.channelId));
				}
				listString += await generateBountyFieldSegment(record, cardMessage);
				segmentCount++;
				listCount++;
				moreRecords = await dbRecords.hasNext();  // Put here because we can only call once otherwise cursor is closed.
			}
			console.log(JSON.stringify(listOfBounties));
			console.log(listString);
			listOfBounties.fields.push({name: '.', value: listString, inline: false});
		}
		const currentDate = new Date();
		const currentDateString = currentDate.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'});
		const currentTimeString = currentDate.toLocaleTimeString('en-US', { timeZone: 'America/New_York', timeZoneName: 'short'});
		let footerText = `As of ${currentDateString + ', ' + currentTimeString}. \nClick on the bounty name for more detail or to take action.\n`;
		if (moreRecords) footerText += `Too many bounties to display. For a full list, click on the list title.\n`;
		if (!listType) footerText += `👷 DM my claimed bounties | 📝 DM my created bounties | 🔄 Refresh list`;
		listOfBounties.footer = { text: footerText };
		if (!listType) {
			if (!!request.message) {
				await request.message.edit({ embeds: [listOfBounties] });
			} else {
				const listMessage = await channel.send({ embeds: [listOfBounties] });
				await listMessage.react('👷');
				await listMessage.react('📝');
				await listMessage.react('🔄');
			}
		} else {
			await listUser.send({ embeds: [listOfBounties] });
		}
	}
};

export const generateBountyFieldSegment = async (bountyRecord: BountyCollection, cardMessage: Message): Promise<any> => {
	const url = !!cardMessage ? cardMessage.url : process.env.BOUNTY_BOARD_URL + bountyRecord._id
	return (
		`> [${bountyRecord.status.toLocaleUpperCase()}] [${bountyRecord.title}](${url}) **${bountyRecord.reward.amount + ' ' + bountyRecord.reward.currency.toUpperCase()}**\n`
	);
}

export const generateListEmbedMessage = async (bountyRecord: BountyCollection, newStatus: string, guildID: string): Promise<MessageEmbedOptions> => {
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
            messageEmbedOptions.fields.push({ name: 'For role', value: role.name, inline: false })
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