import { GuildMember, Message, DMChannel, AwaitMessagesOptions } from 'discord.js';
import { ApplyRequest } from '../../requests/ApplyRequest';
import { BountyCollection } from '../../types/bounty/BountyCollection';
import DiscordUtils from '../../utils/DiscordUtils';
import ValidationError from '../../errors/ValidationError';
import Log from '../../utils/Log';
import mongo, { Db, UpdateWriteOpResult } from 'mongodb';
import MongoDbUtils from '../../utils/MongoDbUtils';
import { CustomerCollection } from '../../types/bounty/CustomerCollection';
import BountyUtils from '../../utils/BountyUtils';
import DMPermissionError from '../../errors/DMPermissionError';

export const applyBounty = async (request: ApplyRequest): Promise<any> => {
    Log.debug('In Apply activity');
    const applyingUser = await DiscordUtils.getGuildMemberFromUserId(request.userId, request.guildId);
    Log.info(`${request.bountyId} bounty applied for by ${applyingUser.user.tag}`);
    
    const pitchMessageText = `Hello @${applyingUser.displayName}!\n` +
        `Please respond to the following within 5 minutes.\n` +
        `Please tell the bounty creator why you should be chosen to claim this bounty (your pitch)`;
    const pitchMessage: Message = await applyingUser.send({ content: pitchMessageText }).catch(() => { throw new DMPermissionError(pitchMessageText) });
    const dmChannel: DMChannel = await pitchMessage.channel.fetch() as DMChannel;
    const replyOptions: AwaitMessagesOptions = {
        max: 1,
        // time is in ms
        time: 300000,
        errors: ['time'],
    };

    const gotoDMMessage = 'Go to your DMs to finish appplying for the bounty...';
    await DiscordUtils.activityResponse(request.commandContext, request.buttonInteraction, gotoDMMessage);

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
    
    const cardMessage = await BountyUtils.canonicalCard(appliedForBounty._id, request.activity);

    const createdByUser: GuildMember = await applyingUser.guild.members.fetch(appliedForBounty.createdBy.discordId);
    let creatorDM = `Your bounty has been applied for by <@${applyingUser.id}> \n` +
                        `Their pitch: ${pitch ? pitch : '<none given>'} \n` +
                        'Use the "/bounty assign" command to select an applicant who can claim.';

    await DiscordUtils.activityNotification(creatorDM, createdByUser, cardMessage.url);
    const activityMessage = `<@${applyingUser.user.id}>, You have applied for this bounty! Reach out to <@${createdByUser.id}> with any questions.`;
    await DiscordUtils.activityResponse(request.commandContext, request.buttonInteraction, activityMessage, cardMessage.url);
    await applyingUser.send({ content: activityMessage })
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
                iconUrl: applyingUser.user.avatarURL(),
                pitch: pitch,
            },
        },
    });

    if (writeResult.result.ok !== 1) {
        Log.error('failed to update applied for bounty with applicant');
        throw new Error(`Write to database for bounty ${request.bountyId} failed for ${request.activity} `);
    }

    return appliedForBounty;
};

