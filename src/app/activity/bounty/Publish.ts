import { TextChannel, Message, MessageEmbedOptions } from 'discord.js'
import Log, { LogUtils } from '../../utils/Log';
import mongo, { Db, UpdateWriteOpResult } from 'mongodb';
import MongoDbUtils from '../../utils/MongoDbUtils';
import { BountyCollection } from '../../types/bounty/BountyCollection';
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

    if (!publishRequest.clientSyncRequest) {
		await writeDbHandler(dbBountyResult);
	}

	const bountyChannel: TextChannel = dbBountyResult.createdInChannel ? await DiscordUtils.getTextChannelfromChannelId(dbBountyResult.createdInChannel) :
		 await guildMember.client.channels.fetch(dbCustomerResult.bountyChannel) as TextChannel;
	const bountyMessage: Message = await BountyUtils.canonicalCard(dbBountyResult._id, publishRequest.activity, bountyChannel);
    await guildMember.send({ content: `Bounty published to ${bountyChannel.name} <${bountyMessage.url}> and the website! <${process.env.BOUNTY_BOARD_URL}${bountyId}>` });
	Log.info(`bounty published to ${bountyChannel.name}`);

	// Remove old publish preview
	if (dbBountyResult.creatorMessage !== undefined) {
		const dmChannel = await guildMember.client.channels.fetch(dbBountyResult.creatorMessage.channelId) as TextChannel;
		const previewMessage = await dmChannel.messages.fetch(dbBountyResult.creatorMessage.messageId).catch(e => {
			LogUtils.logError(`could not find bounty ${dbBountyResult._id} in channel ${dmChannel.id} in guild ${guildId}`, e);
			throw new RuntimeError(e);
		});
		await previewMessage.delete();
	}

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

