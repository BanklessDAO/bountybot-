import { GuildMember, Message, DMChannel, MessageEmbed, TextChannel, AwaitMessagesOptions } from 'discord.js';
import { ApplyRequest } from '../../requests/ApplyRequest';
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

export const applyBounty = async (request: ApplyRequest): Promise<any> => {
    const applyingUser = await DiscordUtils.getGuildMemberFromUserId(request.userId, request.guildId);
    Log.info(`${request.bountyId} bounty applied for by ${applyingUser.user.tag}`);
    
    const pitchMessageText = `Hello @${applyingUser.displayName}!\n` +
        `Please respond to the following within 5 minutes.\n` +
        `Please tell the bounty creator why you should be chosen to claim this bounty (your pitch)`;
    const pitchMessage: Message = await applyingUser.send({ content: pitchMessageText });
    const dmChannel: DMChannel = await pitchMessage.channel.fetch() as DMChannel;
    const replyOptions: AwaitMessagesOptions = {
        max: 1,
        // time is in ms
        time: 300000,
        errors: ['time'],
    };

    const pitch = await DiscordUtils.awaitUserDM(dmChannel, replyOptions);
    try {
        BountyUtils.validatePitch(pitch);
    } catch (e) {
        if (e instanceof ValidationError) {
            applyingUser.send({ content: `<@${applyingUser.user.id}>\n` + e.message })
        }
    }
    
    let getDbResult: {dbBountyResult: BountyCollection, bountyChannel: string} = await getDbHandler(request);

    const appliedForBounty = await writeDbHandler(request, getDbResult.dbBountyResult, applyingUser, pitch);
    
    let bountyEmbedMessage: Message;
    if (!request.message) {
        const bountyChannel: TextChannel = await applyingUser.guild.channels.fetch(getDbResult.bountyChannel) as TextChannel;
        bountyEmbedMessage = await bountyChannel.messages.fetch(getDbResult.dbBountyResult.discordMessageId).catch(e => {
            LogUtils.logError(`could not find bounty ${request.bountyId} in discord #bounty-board channel ${bountyChannel.id} in guild ${request.guildId}`, e);
            throw new RuntimeError(e);
        });
    } else {
        bountyEmbedMessage = request.message;
    }

    // Need to refresh original bounty so the messages are correct
    getDbResult = await getDbHandler(request); 

    await applyBountyMessage(bountyEmbedMessage, getDbResult.dbBountyResult);
    
    const bountyUrl = process.env.BOUNTY_BOARD_URL + appliedForBounty._id;
    const origBountyUrl = process.env.BOUNTY_BOARD_URL + getDbResult.dbBountyResult._id;
    const createdByUser: GuildMember = await applyingUser.guild.members.fetch(getDbResult.dbBountyResult.createdBy.discordId);
    let creatorDM = `Your bounty has been applied for by <@${applyingUser.id}> ${bountyUrl} \n` +
                        `Their pitch: ${pitch ? pitch : '<none given>'} \n` +
                        'Use the "/bounty assign" command in the #bounty-board channel to select an applicant who can claim.';

    await createdByUser.send({ content: creatorDM });

    await applyingUser.send({ content: `You have applied for this bounty! Reach out to <@${createdByUser.id}> with any questions` });
    return;
};

const getDbHandler = async (request: ApplyRequest): Promise<{dbBountyResult: BountyCollection, bountyChannel: string}> => {
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

const writeDbHandler = async (request: ApplyRequest, appliedForBounty: BountyCollection, applyingUser: GuildMember, pitch: string): Promise<BountyCollection> => {
    const db: Db = await MongoDbUtils.connect('bountyboard');
    const bountyCollection = db.collection('bounties');
    const currentDate = (new Date()).toISOString();
    
    const writeResult: UpdateWriteOpResult = await bountyCollection.updateOne(appliedForBounty, {
        $push: {
            applicants: {
                discordId: applyingUser.user.id,
                discordHandle: applyingUser.user.tag,
                pitch: pitch,
            },
        },
    });

    if (writeResult.result.ok !== 1) {
        Log.error('failed to update applied for bounty with applicant');
        throw new Error(`Write to database for bounty ${request.bountyId} failed for ${request.activity} `);
    }

    return appliedForBounty;
}

export const applyBountyMessage = async (message: Message, appliedForBounty: BountyCollection): Promise<any> => {
    Log.debug(`fetching bounty message for apply`)
    
    const embedOrigMessage: MessageEmbed = message.embeds[0];
    embedOrigMessage.setTitle(await BountyUtils.createPublicTitle(<Bounty>appliedForBounty));
    await message.edit({ embeds: [embedOrigMessage] });
};

