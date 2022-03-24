import { DeleteRequest } from '../../requests/DeleteRequest';
import DiscordUtils from '../../utils/DiscordUtils';
import Log, { LogUtils } from '../../utils/Log';
import { GuildMember, Message, TextChannel } from 'discord.js';
import MongoDbUtils from '../../utils/MongoDbUtils';
import mongo, { Db, UpdateWriteOpResult } from 'mongodb';
import { BountyCollection } from '../../types/bounty/BountyCollection';
import { CustomerCollection } from '../../types/bounty/CustomerCollection';
import RuntimeError from '../../errors/RuntimeError';
import { BountyStatus } from '../../constants/bountyStatus';


export const deleteBounty = async (request: DeleteRequest): Promise<void> => {
    Log.debug('In Delete activity');

    const deletedByUser = await DiscordUtils.getGuildMemberFromUserId(request.userId, request.guildId);
	Log.info(`${request.bountyId} bounty deleted by ${deletedByUser.user.tag}`);
	
    const getDbResult: {dbBountyResult: BountyCollection, bountyChannel: string} = await getDbHandler(request);
    await writeDbHandler(request, deletedByUser);

    let bountyEmbedMessage: Message;
    if (!request.message) {
        if (getDbResult.dbBountyResult.discordMessageId !== undefined) {
            const bountyChannel: TextChannel = await deletedByUser.guild.channels.fetch(getDbResult.bountyChannel) as TextChannel;
            bountyEmbedMessage = await bountyChannel.messages.fetch(getDbResult.dbBountyResult.discordMessageId).catch(e => {
                LogUtils.logError(`could not find bounty ${request.bountyId} in discord #bounty-board channel ${bountyChannel.id} in guild ${request.guildId}`, e);
                throw new RuntimeError(e);
            });
        } else {
            const bountyChannel: TextChannel = await deletedByUser.client.channels.fetch(getDbResult.dbBountyResult.creatorMessage.channelId) as TextChannel;
            bountyEmbedMessage = await bountyChannel.messages.fetch(getDbResult.dbBountyResult.creatorMessage.messageId).catch(e => {
                LogUtils.logError(`could not find bounty ${request.bountyId} in DM channel ${bountyChannel.id} in guild ${request.guildId}`, e);
                throw new RuntimeError(e);
            });
        }
    } else {
        bountyEmbedMessage = request.message;
    }
   
    await deleteBountyMessage(bountyEmbedMessage);
	
	const bountyUrl = process.env.BOUNTY_BOARD_URL + request.bountyId;
	let creatorDeleteDM = 
        `The following bounty has been deleted: <${bountyUrl}>\n`;

    if (getDbResult.dbBountyResult.evergreen && getDbResult.dbBountyResult.isParent &&
        getDbResult.dbBountyResult.childrenIds !== undefined && getDbResult.dbBountyResult.childrenIds.length > 0) {
        creatorDeleteDM += 'Children bounties created from this multi-claimant bounty will remain.\n';
    }

    await deletedByUser.send({ content: creatorDeleteDM });
    return;
}

/**
 * Wraps read only calls to the database.
 * Intended to be replaced with calls to the API.
 * Note that the full customer read result is left out to be forward compatible with
 *     publishing bounties to a specified discord channel or multiple discord channels.
 *     This is b/c bountyChannel will be consumed from the bounty record at every step except publish
 * @param request DeleteRequest, passed from activity initiator
 * @returns 
 */
const getDbHandler = async (request: DeleteRequest): Promise<{dbBountyResult: BountyCollection, bountyChannel: string}> => {
    const db: Db = await MongoDbUtils.connect('bountyboard');
	const bountyCollection = db.collection('bounties');
    const customerCollection = db.collection('customers');

	const dbBountyResult: BountyCollection = await bountyCollection.findOne({
		_id: new mongo.ObjectId(request.bountyId),
	});

    if (request.message) {
        return {
            dbBountyResult: dbBountyResult,
            bountyChannel: null
        }
    }

    const dbCustomerResult: CustomerCollection = await customerCollection.findOne({
        customerId: request.guildId,
    });

    return {
        dbBountyResult: dbBountyResult,
        bountyChannel: dbCustomerResult.bountyChannel
    }
}

// TODO: consider adding the previous read result as a parameter to save a db read
const writeDbHandler = async (request: DeleteRequest, deletedByUser: GuildMember): Promise<void> => {
    const db: Db = await MongoDbUtils.connect('bountyboard');
	const bountyCollection = db.collection('bounties');

	const dbBountyResult: BountyCollection = await bountyCollection.findOne({
		_id: new mongo.ObjectId(request.bountyId),
	});

	const currentDate = (new Date()).toISOString();
	const writeResult: UpdateWriteOpResult = await bountyCollection.updateOne(dbBountyResult, {
		$set: {
			deletedBy: {
				discordHandle: deletedByUser.user.tag,
				discordId: deletedByUser.user.id,
				iconUrl: deletedByUser.user.avatarURL(),
			},
            // TO-DO: What is the point of status history if we publish createdAt, claimedAt... as first class fields?
            // note that createdAt, claimedAt are not part of the BountyCollection type
			deletedAt: currentDate,
			status: BountyStatus.deleted,
            resolutionNote: request.resolutionNote,
		},
		$push: {
			statusHistory: {
				status: BountyStatus.deleted,
				setAt: currentDate,
			},
		},
	});

    if (writeResult.result.ok !== 1) {
        Log.error(`Write result did not execute correctly`);
        throw new Error(`Write to database for bounty ${request.bountyId} failed for Delete `);
    }
}

export const deleteBountyMessage = async (message: Message): Promise<void> => {
    await message.delete();
};