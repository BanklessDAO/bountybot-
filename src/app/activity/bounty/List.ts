import MongoDbUtils  from '../../utils/MongoDbUtils';
import { Cursor, Db } from 'mongodb';
import { Message, MessageEmbedOptions, Role } from 'discord.js';
import Log from '../../utils/Log';
import { BountyCollection } from '../../types/bounty/BountyCollection';
import DiscordUtils from '../../utils/DiscordUtils';
import { ListRequest } from '../../requests/ListRequest';
import { CustomerCollection } from '../../types/bounty/CustomerCollection';
import { BountyStatus } from '../../constants/bountyStatus';

const DB_RECORD_LIMIT = 25;

export const listBounty = async (request: ListRequest): Promise<any> => {
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
				// TO DO catch error here and rebuild canonical card if channel or message are missing.
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
	let listMessage: Message;
	if (!listType) {
		if (!!request.message) {  // List from a refresh reaction
			listMessage = request.message;
			await listMessage.edit({ embeds: [listOfBounties] });
			await listMessage.reactions.removeAll();
		} else {  // List from a slash command
			const channel = await DiscordUtils.getTextChannelfromChannelId(request.commandContext.channelID);
			listMessage = await channel.send({ embeds: [listOfBounties] });
		}
		await listMessage.react('👷');
		await listMessage.react('📝');
		await listMessage.react('🔄');

	} else {  // List from a DM reaction
		await listUser.send({ embeds: [listOfBounties] });
	}
};

export const generateBountyFieldSegment = async (bountyRecord: BountyCollection, cardMessage: Message): Promise<any> => {
	const url = !!cardMessage ? cardMessage.url : process.env.BOUNTY_BOARD_URL + bountyRecord._id
	return (
		`> [${bountyRecord.status.toLocaleUpperCase()}] [${bountyRecord.title}](${url}) **${bountyRecord.reward.amount + ' ' + bountyRecord.reward.currency.toUpperCase()}**\n`
	);
};