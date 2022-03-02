import { GuildMember, Message, DMChannel, MessageEmbed, TextChannel, AwaitMessagesOptions, GuildEmoji } from 'discord.js';
import { AssignRequest } from '../../requests/AssignRequest';
import { BountyCollection } from '../../types/bounty/BountyCollection';
import { Bounty } from '../../types/bounty/Bounty';
import DiscordUtils from '../../utils/DiscordUtils';
import ValidationError from '../../errors/ValidationError';
import Log, { LogUtils } from '../../utils/Log';
import mongo, { Cursor, Db, UpdateWriteOpResult } from 'mongodb';
import MongoDbUtils from '../../utils/MongoDbUtils';
import { CustomerCollection } from '../../types/bounty/CustomerCollection';
import RuntimeError from '../../errors/RuntimeError';
import { BountyEmbedFields } from '../../constants/embeds';
import { BountyStatus } from '../../constants/bountyStatus';
import BountyUtils from '../../utils/BountyUtils';

export const assignBounty = async (request: AssignRequest): Promise<any> => {
    Log.debug('In Assign activity');

    const assigningUser = await DiscordUtils.getGuildMemberFromUserId(request.userId, request.guildId);
    Log.info(`${request.bountyId} bounty being assigned by ${assigningUser.user.tag}`);
    
    let getDbResult: {dbBountyResult: BountyCollection, bountyChannel: string} = await getDbHandler(request);

    const assignedUser: GuildMember = await assigningUser.guild.members.fetch(request.assign);
    const assignedBounty = await writeDbHandler(request, getDbResult.dbBountyResult, assignedUser);
    
    let bountyEmbedMessage: Message;
    if (!request.message) {
        const bountyChannel: TextChannel = await assigningUser.guild.channels.fetch(getDbResult.bountyChannel) as TextChannel;
        bountyEmbedMessage = await bountyChannel.messages.fetch(getDbResult.dbBountyResult.discordMessageId).catch(e => {
            LogUtils.logError(`could not find bounty ${request.bountyId} in discord #bounty-board channel ${bountyChannel.id} in guild ${request.guildId}`, e);
            throw new RuntimeError(e);
        });
    } else {
        bountyEmbedMessage = request.message;
    }

    // Need to refresh original bounty so the messages are correct
    getDbResult = await getDbHandler(request); 
 

    await assignedBountyMessage(bountyEmbedMessage, getDbResult.dbBountyResult);
    
    const bountyUrl = process.env.BOUNTY_BOARD_URL + assignedBounty._id;
    let assigningDM = `Your bounty has been assigned to <@${assignedUser.user.id}> ${bountyUrl}`;

    await assigningUser.send({ content: assigningDM });

    await assignedUser.send({ content: `You have been assigned this bounty! Go to the #bounty-board channel to claim it. Reach out to <@${assigningUser.id}> with any questions\n` +
                                         `<${bountyUrl}>`});
    return;
};

const getDbHandler = async (request: AssignRequest): Promise<{dbBountyResult: BountyCollection, bountyChannel: string}> => {
    const db: Db = await MongoDbUtils.connect('bountyboard');
    const bountyCollection = db.collection('bounties');
    const customerCollection = db.collection('customers');

    const dbBountyResult: BountyCollection = await bountyCollection.findOne({
        _id: new mongo.ObjectId(request.bountyId)
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

const writeDbHandler = async (request: AssignRequest, assignedBounty: BountyCollection, assignedUser: GuildMember): Promise<BountyCollection> => {
    const db: Db = await MongoDbUtils.connect('bountyboard');
    const bountyCollection = db.collection('bounties');
    
    const writeResult: UpdateWriteOpResult = await bountyCollection.updateOne(assignedBounty, {
        $set: {
            assign: request.assign,
            assignedName: assignedUser.user.tag
        },
    });

    if (writeResult.result.ok !== 1) {
        Log.error('failed to update assigned bounty');
        throw new Error(`Write to database for bounty ${request.bountyId} failed for ${request.activity} `);
    }

    return assignedBounty;
}

export const assignedBountyMessage = async (message: Message, appliedForBounty: BountyCollection): Promise<any> => {
    Log.debug(`fetching bounty message for assign`)
    
    const embedOrigMessage: MessageEmbed = message.embeds[0];
    embedOrigMessage.setTitle(await BountyUtils.createPublicTitle(<Bounty>appliedForBounty));
    embedOrigMessage.setFooter({text: '🏴 - claim | ❌ - delete'});
    await message.edit({ embeds: [embedOrigMessage] });
	await message.reactions.removeAll();
	await message.react('🏴');
	await message.react('❌');

};

