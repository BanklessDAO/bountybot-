import { TextChannel, Message } from 'discord.js'
import Log from '../../utils/Log';
import mongo, { Db, UpdateWriteOpResult } from 'mongodb';
import MongoDbUtils from '../../utils/MongoDbUtils';
import { BountyCollection } from '../../types/bounty/BountyCollection';
import { CustomerCollection } from '../../types/bounty/CustomerCollection';
import DiscordUtils from '../../utils/DiscordUtils';
import BountyUtils from '../../utils/BountyUtils';
import { PublishRequest } from '../../requests/PublishRequest';
import { BountyStatus } from '../../constants/bountyStatus';
import { Activities } from '../../constants/activities';
import { Clients } from '../../constants/clients';
import Bounty from '../../commands/bounty/Bounty';

export const publishBounty = async (publishRequest: PublishRequest): Promise<any> => {
	Log.debug('In Publish activity');

	const bountyId = publishRequest.bountyId;
	const guildId = publishRequest.guildId;

	Log.info(`starting to finalize bounty: ${bountyId} from guild: ${guildId}`);

	const { guildMember } = await DiscordUtils.getGuildAndMember(publishRequest.guildId, publishRequest.userId);

	const [dbBountyResult, dbCustomerResult] = await getDbHandler(bountyId, guildId, publishRequest);

	if (!publishRequest.clientSyncRequest && dbBountyResult.status == BountyStatus.draft) {
		await writeDbHandler(dbBountyResult);
	}

	let bountyChannel: TextChannel;
	// Possible channel was deleted prior to publish or refresh
	try {
	    bountyChannel = dbBountyResult.createdInChannel ? await DiscordUtils.getTextChannelfromChannelId(dbBountyResult.createdInChannel) :
		await guildMember.client.channels.fetch(dbCustomerResult.bountyChannel) as TextChannel;
	} catch(e) {
		bountyChannel = undefined;
	}
	const bountyMessage: Message = await BountyUtils.canonicalCard(dbBountyResult._id, publishRequest.activity, bountyChannel, guildMember);
	if (dbBountyResult.status == BountyStatus.draft || publishRequest.commandContext) {
		await DiscordUtils.activityResponse(publishRequest.commandContext, publishRequest.buttonInteraction,  `Bounty published to \`${(bountyMessage.channel as any).name || bountyChannel.name}\` and the website! <${process.env.BOUNTY_BOARD_URL}${bountyId}>`, bountyMessage.url);
	}

	Log.info(`bounty published to ${(bountyMessage.channel as any).name || bountyChannel.name}`);

	// Remove old publish preview
	if (dbBountyResult.creatorMessage !== undefined) {
		const dmChannel = await guildMember.client.channels.fetch(dbBountyResult.creatorMessage.channelId) as TextChannel;
		const previewMessage = await dmChannel.messages.fetch(dbBountyResult.creatorMessage.messageId);
		await previewMessage.delete();
	}

	await DiscordUtils.refreshLastList(dbCustomerResult.customerId, publishRequest);
	
	return;
}

const getDbHandler = async (bountyId: string, guildId: string, request: PublishRequest): Promise<[BountyCollection, CustomerCollection]> => {
	Log.debug(`Entered get DbHandler for publish`);
	const db: Db = await MongoDbUtils.connect('bountyboard');
	const dbCollectionBounties = db.collection('bounties');
	const dbCollectionCustomers = db.collection('customers');

	let search = { _id: new mongo.ObjectId(bountyId) };

	// If we are syncing from web, status should be Open
	if (request.clientSyncRequest) search["status"] = 'Open';

	const dbCustomerResult: CustomerCollection = await dbCollectionCustomers.findOne({
		customerId: guildId
	});
	const dbBountyResult: BountyCollection = await dbCollectionBounties.findOne(search);

	return [dbBountyResult, dbCustomerResult];

}

const writeDbHandler = async (dbBountyResult: BountyCollection): Promise<any> => {
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

