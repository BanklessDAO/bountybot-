import { GuildMember, Message, MessageEmbed, TextChannel } from 'discord.js';
import { ClaimRequest } from '../../requests/ClaimRequest';
import { BountyCollection } from '../../types/bounty/BountyCollection';
import DiscordUtils from '../../utils/DiscordUtils';
import Log, { LogUtils } from '../../utils/Log';
import mongo, { Cursor, Db, UpdateWriteOpResult } from 'mongodb';
import MongoDbUtils from '../../utils/MongoDbUtils';
import { CustomerCollection } from '../../types/bounty/CustomerCollection';
import RuntimeError from '../../errors/RuntimeError';
import { BountyEmbedFields } from '../../constants/embeds';
import { BountyStatus } from '../../constants/bountyStatus';
import { Bounty } from '../../types/bounty/Bounty';

export const claimBounty = async (request: ClaimRequest): Promise<any> => {
    const claimedByUser = await DiscordUtils.getGuildMemberFromUserId(request.userId, request.guildId);
    Log.info(`${request.bountyId} bounty claimed by ${claimedByUser.user.tag}`);
    
    let getDbResult: {dbBountyResult: BountyCollection, bountyChannel: string, childrenBounties: BountyCollection[]} = await getDbHandler(request);
    const claimedBountyId = await writeDbHandler(request, getDbResult.dbBountyResult, claimedByUser);
    
    let bountyEmbedMessage: Message;
    // TODO: consider changing claim, submit, complete, and delete requests to have a channel id instead of the complete Message
    if (!request.message) {
        const bountyChannel: TextChannel = await claimedByUser.guild.channels.fetch(getDbResult.bountyChannel) as TextChannel;
        bountyEmbedMessage = await bountyChannel.messages.fetch(getDbResult.dbBountyResult.discordMessageId).catch(e => {
            LogUtils.logError(`could not find bounty ${request.bountyId} in discord #bounty-board channel ${bountyChannel.id} in guild ${request.guildId}`, e);
            throw new RuntimeError(e);
        });
    } else {
        bountyEmbedMessage = request.message;
    }

    // Need to refresh original bounty to get correct children list
    if (getDbResult.dbBountyResult.evergreen) {
        getDbResult = await getDbHandler(request); 

    }

    await claimBountyMessage(bountyEmbedMessage, claimedByUser, getDbResult.dbBountyResult, getDbResult.childrenBounties);
    
    const bountyUrl = process.env.BOUNTY_BOARD_URL + claimedBountyId;
    const origBountyUrl = process.env.BOUNTY_BOARD_URL + getDbResult.dbBountyResult._id;
    const createdByUser: GuildMember = await claimedByUser.guild.members.fetch(getDbResult.dbBountyResult.createdBy.discordId);
    let creatorClaimDM = `Your bounty has been claimed by <@${claimedByUser.user.id}> ${bountyUrl}`;
    if (getDbResult.dbBountyResult.evergreen) {
        creatorClaimDM += `\nSince you marked your original bounty as evergreen, it will stay on the board as Open. ${origBountyUrl}`;
    }

    await createdByUser.send({ content: creatorClaimDM });

    await claimedByUser.send({ content: `You have claimed this bounty: ${bountyUrl}! Reach out to <@${createdByUser.id}> (${createdByUser.displayName}) with any questions` });
    return;
};

const getDbHandler = async (request: ClaimRequest): Promise<{dbBountyResult: BountyCollection, bountyChannel: string, childrenBounties: BountyCollection[]}> => {
    const db: Db = await MongoDbUtils.connect('bountyboard');
    const bountyCollection = db.collection('bounties');
    const customerCollection = db.collection('customers');

    const dbBountyResult: BountyCollection = await bountyCollection.findOne({
        _id: new mongo.ObjectId(request.bountyId),
        status: BountyStatus.open,
    });

    const childrenBounties: BountyCollection[] = [];
    if (dbBountyResult.evergreen && dbBountyResult.childrenIds !== undefined && dbBountyResult.childrenIds.length > 0) {
        const childrenBountiesCursor: Cursor  = bountyCollection.find({ _id: { $in: dbBountyResult.childrenIds }});
        while (await childrenBountiesCursor.hasNext()) {
            childrenBounties.push(await childrenBountiesCursor.next());
        }
    }

    if (request.message) {
        return {
            dbBountyResult: dbBountyResult,
            bountyChannel: null,
            childrenBounties: childrenBounties
        }
    }

    const dbCustomerResult: CustomerCollection = await customerCollection.findOne({
        customerId: request.guildId,
    });

    return {
        dbBountyResult: dbBountyResult,
        bountyChannel: dbCustomerResult.bountyChannel,
        childrenBounties: childrenBounties
    }
}

const writeDbHandler = async (request: ClaimRequest, dbBountyResult: BountyCollection, claimedByUser: GuildMember): Promise<{claimedBountyId: mongo.ObjectId}> => {
    const db: Db = await MongoDbUtils.connect('bountyboard');
    const bountyCollection = db.collection('bounties');
    let claimedBounty: BountyCollection;

    // If claiming an evergreen bounty, create a copy and use that
    if (dbBountyResult.evergreen) {
        const bountyRec: BountyCollection = JSON.parse(JSON.stringify(dbBountyResult));
        bountyRec.parentId = bountyRec._id;
        delete bountyRec._id;
        delete bountyRec.isParent;
        const claimedInsertResult = await bountyCollection.insertOne(bountyRec);
        if (claimedInsertResult == null) {
            Log.error('failed to create claimed bounty from evergreen');
            throw new Error('Sorry something is not working, our devs are looking into it.');
        }
        claimedBounty = await bountyCollection.findOne({_id: claimedInsertResult.insertedId});
        const updatedBountyResult: UpdateWriteOpResult = await bountyCollection.updateOne(dbBountyResult, {
            $push: {
                childrenIds: claimedBounty._id
            }
        });
        if (updatedBountyResult == null) {
            Log.error('failed to update evergreen bounty wth claimed Id');
            throw new Error('Sorry something is not working, our devs are looking into it.');
        }
    } else {
        claimedBounty = dbBountyResult;
    }
 
    const currentDate = (new Date()).toISOString();
    const writeResult: UpdateWriteOpResult = await bountyCollection.updateOne(claimedBounty, {
        $set: {
            claimedBy: {
                discordHandle: claimedByUser.user.tag,
                discordId: claimedByUser.user.id,
                iconUrl: claimedByUser.user.avatarURL(),
            },
            claimedAt: currentDate,
            status: BountyStatus.in_progress,
        },
        $push: {
            statusHistory: {
                status: BountyStatus.in_progress,
                setAt: currentDate,
            },
        },
    });

    if (writeResult.result.ok !== 1) {
        Log.error(`Write result did not execute correctly`);
        throw new Error(`Write to database for bounty ${request.bountyId} failed for ${request.activity} `);
    }

    return claimedBounty._id;
}

export const claimBountyMessage = async (message: Message, claimedByUser: GuildMember, originalBounty: BountyCollection, childrenBounties: BountyCollection[]): Promise<any> => {
    Log.debug(`fetching bounty message for claim`)
    
    const embedMessage: MessageEmbed = message.embeds[0];


    if (originalBounty.evergreen) {
        let claimedBy = claimedByUser.user.tag;
        if (childrenBounties.length > 1) {
            claimedBy += `, and ${childrenBounties.length - 1} more`;
            embedMessage.fields[BountyEmbedFields.claimedBy].value = claimedBy;
        } else {
        embedMessage.addField('Claimed by', claimedBy, true);
        }
    } else {
        embedMessage.fields[BountyEmbedFields.status].value = BountyStatus.in_progress;
        embedMessage.setColor('#d39e00');
        embedMessage.addField('Claimed by', claimedByUser.user.tag, true);
        embedMessage.setFooter('📮 - submit | 🆘 - help');
        await addClaimReactions(message);
    }
    await message.edit({ embeds: [embedMessage] });
};

export const addClaimReactions = async (message: Message): Promise<any> => {
    await message.reactions.removeAll();
    await message.react('📮');
    await message.react('🆘');
};