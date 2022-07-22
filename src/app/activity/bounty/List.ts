import MongoDbUtils  from '../../utils/MongoDbUtils';
import mongo, { Cursor, Db, UpdateWriteOpResult } from 'mongodb';
import { Message, MessageActionRow, MessageButton, MessageEmbedOptions } from 'discord.js';
import Log from '../../utils/Log';
import { BountyCollection } from '../../types/bounty/BountyCollection';
import DiscordUtils from '../../utils/DiscordUtils';
import { ListRequest } from '../../requests/ListRequest';
import { CustomerCollection } from '../../types/bounty/CustomerCollection';
import { BountyStatus } from '../../constants/bountyStatus';
import { ConnectionVisibility } from 'discord-api-types';
import DMPermissionError from '../../errors/DMPermissionError';

const TOTAL_BOUNTY_LIMIT = 15;
const BOUNTY_SEGMENT_LIMIT = 5;

export const listBounty = async (request: ListRequest, preventResponse ?: boolean): Promise<any> => {
	Log.debug('In List activity');

    const listUser = await DiscordUtils.getGuildMemberFromUserId(request.userId, request.guildId)
    const listType: string = request.listType;

    let dbRecords: Cursor;
	const db: Db = await MongoDbUtils.connect('bountyboard');
	const bountyCollection = db.collection('bounties');
    const customerCollection = db.collection('customers');

    const dbCustomerResult: CustomerCollection = await customerCollection.findOne({
        customerId: request.guildId,
    });

    Log.info('Bounty list type: ' + listType);

	let listTitle: string;
	let openTitle = "Open";

	switch (listType) { 
	case 'CREATED_BY_ME':
		dbRecords = bountyCollection.find({ 'createdBy.discordId': listUser.user.id, status: { $ne: 'Deleted' }, 'customerId': request.guildId }).sort({ status: -1, createdAt: -1 });
		listTitle = "📝 Bounties Created by Me";
		break;
	case 'CLAIMED_BY_ME':
		dbRecords = bountyCollection.find({ $or: [ { 'claimedBy.discordId': listUser.user.id }, { applicants: { $elemMatch: { discordId: listUser.user.id }}} ] , status: { $ne: 'Deleted' }, 'customerId': request.guildId }).sort({ status: -1, createdAt: -1 });
		listTitle = "👷 Bounties Claimed or Applied For by Me";
		openTitle = "Applied For"
		break;
	default: 
		dbRecords = bountyCollection.find({ $or: [ { status: BountyStatus.open } , { status: BountyStatus.in_progress }, { status: BountyStatus.in_review } ], isIOU: { $ne: true }, 'customerId': request.guildId }).sort({ status: -1, createdAt: -1 });
		listTitle =  "💰 Active Bounties";
	}

	const listCard: MessageEmbedOptions = {
		title: listTitle,
		url: process.env.BOUNTY_BOARD_URL,
		color: 1998388,
		fields: []
	};
	let listCount = 0;
	const bountyList = {};
	let moreRecords = await dbRecords.hasNext();
	while (listCount < TOTAL_BOUNTY_LIMIT && moreRecords) {
		const record: BountyCollection = await dbRecords.next();
		let cardMessage: Message;
		if (record.canonicalCard !== undefined) {  
			// TO DO catch error here and rebuild canonical card if channel or message are missing.
			try {
				cardMessage = await DiscordUtils.getMessagefromMessageId(record.canonicalCard.messageId, await DiscordUtils.getTextChannelfromChannelId(record.canonicalCard.channelId));
			} catch {
				cardMessage = undefined;
			}
		}
		if (!bountyList[record.status]) {
			bountyList[record.status] = {};
			bountyList[record.status]._index = 0;
		}
		bountyList[record.status][bountyList[record.status]._index++] = await generateBountyFieldSegment(record, cardMessage, listType);
		listCount++;
		moreRecords = await dbRecords.hasNext();  // Put here because we can only call once otherwise cursor is closed.
	}
	if (moreRecords) {
		listCard.description = `Partial list. For a full list, click on the above title.`;
	} 

	if (listCount == 0) {
		listCard.fields.push({name: '.', value: "No bounties found!", inline: false})
	} else {
		for (const status of [BountyStatus.open, BountyStatus.in_progress, BountyStatus.in_review, BountyStatus.complete]) {
			if (!!bountyList[status]) {
				let segmentString = '';
				let sectionTitle = '';
				for (let statusCount = 0; !!bountyList[status][`${statusCount}`]; statusCount++) {
					if (statusCount % BOUNTY_SEGMENT_LIMIT == 0) {
						if (statusCount == 0) {
							sectionTitle = status == BountyStatus.open ? openTitle: status;
						} else {
							listCard.fields.push({ name: sectionTitle, value: segmentString, inline: false });
							segmentString = '';
							sectionTitle = '-';
						}
					}
					segmentString += bountyList[status][`${statusCount}`];
				}
				if (segmentString != '') {  // Add in leftovers
					listCard.fields.push({ name: sectionTitle, value: segmentString, inline: false });
				}
			}
		}
	}

	const currentDate = new Date();
	const currentDateString = currentDate.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'});
	const currentTimeString = currentDate.toLocaleTimeString('en-US', { timeZone: 'America/New_York', timeZoneName: 'short'});
	let footerText = `As of ${currentDateString + ', ' + currentTimeString}. \nClick on the bounty name for more detail or to take action.\n`;
	if (!listType) footerText += `👷 DM my claimed or applied for bounties | 📝 DM my created bounties | 🔄 Refresh list`;
	listCard.footer = { text: footerText };
	let listMessage: Message;
	if (!listType) {
		const componentActions = new MessageActionRow().addComponents(['👷', '📝', '🔄'].map(a => 
			new MessageButton().setEmoji(a).setStyle('SECONDARY').setCustomId(a)
		))
		if (!!request.message) {  // List from a refresh reaction
			listMessage = request.message;
			await listMessage.edit({ embeds: [listCard], components: [componentActions] });
			!preventResponse && await DiscordUtils.activityResponse(null, request.buttonInteraction, 'Bounty list refreshed successfully');
		} else {  // List from a slash command
			const channel = await DiscordUtils.getTextChannelfromChannelId(request.commandContext.channelID);
			listMessage = await channel.send({ embeds: [listCard], components: [componentActions] });
			if (request.commandContext.channelID == dbCustomerResult.bountyChannel) {
				const writeResult: UpdateWriteOpResult = await customerCollection.updateOne( {customerId: request.guildId}, {
					$set: {
						lastListMessage: listMessage.url,
					},
				});
			}
			await request.commandContext.delete();  // We're done
		}
	} else {  // List from a DM reaction
		try {
			const componentActions = new MessageActionRow().addComponents(
				new MessageButton()
					.setLabel('Back to List')
					.setStyle('LINK')
					.setURL(dbCustomerResult.lastListMessage)
			);
			await listUser.send({ embeds: [listCard], components: [componentActions] });
		} catch (e) {
			throw new DMPermissionError(e);
		}
		await DiscordUtils.activityResponse(null, request.buttonInteraction, 'Please check your DM for bounty list');

	}
};

export const generateBountyFieldSegment = async (bountyRecord: BountyCollection, cardMessage: Message, listType: string): Promise<any> => {
	const url = !!cardMessage ? cardMessage.url : process.env.BOUNTY_BOARD_URL + bountyRecord._id
	let forString = '';

	if (bountyRecord.claimedBy) {
		let claimedByMeMetadata = getClaimedByMeMetadata(bountyRecord, listType);
		forString = claimedByMeMetadata ?  claimedByMeMetadata : `claimed by @${bountyRecord.claimedBy.discordHandle}`;
	} else {
	  if (bountyRecord.gate) {
			const role = await DiscordUtils.getRoleFromRoleId(bountyRecord.gate[0], bountyRecord.customerId);
			forString = `claimable by role ${role ? role.name : "<missing role>"}`;
		} else if (bountyRecord.assign) {
			const assignedUser = await DiscordUtils.getGuildMemberFromUserId(bountyRecord.assign, bountyRecord.customerId);
			forString = `claimable by user ${assignedUser ? assignedUser.user.tag : "<missing user>"}`;
		} else {
			forString = 'claimable by anyone';
		}	
	}
	
	return (
		`> [${bountyRecord.title}](${url}) ${forString} **${bountyRecord.reward.amount + ' ' + bountyRecord.reward.currency.toUpperCase()}**\n`
	);
};

const getClaimedByMeMetadata = (record: BountyCollection, listType: string) => {
	let text = '';
	
	if (listType === 'CLAIMED_BY_ME') {
		  if (record.status === BountyStatus.complete) {
				text = `payment is ${record.paidStatus.toUpperCase()}`;
			} else if (record.status === BountyStatus.in_progress || record.status === BountyStatus.in_review) {
				text = `is due on ${new Date (record.dueAt).toLocaleDateString()}`;
			}
		}
		
	return text;
};
