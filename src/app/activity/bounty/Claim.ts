import { GuildMember, Message, MessageEmbed, TextChannel } from 'discord.js';
import { ClaimRequest } from '../../requests/ClaimRequest';
import { BountyCollection } from '../../types/bounty/BountyCollection';
import { Bounty } from '../../types/bounty/Bounty';
import DiscordUtils from '../../utils/DiscordUtils';
import Log, { LogUtils } from '../../utils/Log';
import mongo, { Cursor, Db, UpdateWriteOpResult } from 'mongodb';
import MongoDbUtils from '../../utils/MongoDbUtils';
import { CustomerCollection } from '../../types/bounty/CustomerCollection';
import RuntimeError from '../../errors/RuntimeError';
import { BountyEmbedFields } from '../../constants/embeds';
import { BountyStatus } from '../../constants/bountyStatus';
import BountyUtils from '../../utils/BountyUtils';
import { Activities } from '../../constants/activities';
import { Clients } from '../../constants/clients';

export const claimBounty = async (request: ClaimRequest): Promise<any> => {
    Log.debug('In Claim activity');

    const claimedByUser = await DiscordUtils.getGuildMemberFromUserId(request.userId, request.guildId);
    Log.info(`${request.bountyId} bounty claimed by ${claimedByUser.user.tag}`);
    
    let getDbResult: {dbBountyResult: BountyCollection, bountyChannel: string} = await getDbHandler(request);

    let claimedBounty = getDbResult.dbBountyResult;
    if (!request.clientSyncRequest) {
        claimedBounty = await writeDbHandler(request, getDbResult.dbBountyResult, claimedByUser);
    }
    
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

    // Need to refresh original bounty so the messages are correct
    getDbResult = await getDbHandler(request); 
    const createdByUser: GuildMember = await claimedByUser.guild.members.fetch(getDbResult.dbBountyResult.createdBy.discordId);
    await claimBountyMessage(bountyEmbedMessage, claimedBounty, createdByUser, claimedByUser, getDbResult.dbBountyResult);
    
    const bountyUrl = process.env.BOUNTY_BOARD_URL + claimedBounty._id;
    const origBountyUrl = process.env.BOUNTY_BOARD_URL + getDbResult.dbBountyResult._id;
    let creatorClaimDM = `Your bounty has been claimed by <@${claimedByUser.user.id}> <${bountyUrl}>`;
    if (getDbResult.dbBountyResult.evergreen) {
        if (getDbResult.dbBountyResult.status == BountyStatus.open) {
            creatorClaimDM += `\nSince you marked your original bounty as multi-claimant, it will stay on the board as Open. <${origBountyUrl}>`;
        } else {
            creatorClaimDM += `\nYour multi-claimant bounty has reached its claim limit and has been marked deleted. <${origBountyUrl}>`;
        }
    }

    await createdByUser.send({ content: creatorClaimDM });

    await claimedByUser.send({ content: `You have claimed this bounty! Reach out to <@${createdByUser.user.id}> with any questions` });
    return;
};

const getDbHandler = async (request: ClaimRequest): Promise<{dbBountyResult: BountyCollection, bountyChannel: string}> => {
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

const writeDbHandler = async (request: ClaimRequest, dbBountyResult: BountyCollection, claimedByUser: GuildMember): Promise<BountyCollection> => {
    const db: Db = await MongoDbUtils.connect('bountyboard');
    const bountyCollection = db.collection('bounties');
    let claimedBounty: BountyCollection;
    const currentDate = (new Date()).toISOString();

    // If claiming an evergreen bounty, create a copy and use that
    if (dbBountyResult.evergreen) {
        const childBounty: BountyCollection = Object.assign({}, dbBountyResult);
        childBounty.parentId = childBounty._id;
        delete childBounty._id;
        delete childBounty.isParent;
        delete childBounty.childrenIds;
        delete childBounty.claimLimit;
        const claimedInsertResult = await bountyCollection.insertOne(childBounty);
        if (claimedInsertResult == null) {
            Log.error('failed to create claimed bounty from evergreen');
            throw new Error('Sorry something is not working, our devs are looking into it.');
        }
        claimedBounty = await bountyCollection.findOne({_id: claimedInsertResult.insertedId});
        let updatedParentBountyResult: UpdateWriteOpResult = await bountyCollection.updateOne({ _id: new mongo.ObjectId(dbBountyResult._id) }, {
            $push: {
                childrenIds: claimedBounty._id
            }
        });
        if (updatedParentBountyResult == null) {
            Log.error('failed to update evergreen bounty with claimed Id');
            throw new Error('Sorry something is not working, our devs are looking into it.');
        }

        // Pull it back for second update
        // dbBountyResult = await bountyCollection.findOne({
        //    _id: new mongo.ObjectId(dbBountyResult._id)
        // });
    

        // If we have hit the claim limit, close this bounty
        if (dbBountyResult.claimLimit !== undefined) {
            const claimedCount = (dbBountyResult.childrenIds !== undefined ? dbBountyResult.childrenIds.length : 0);
            if (claimedCount >= dbBountyResult.claimLimit - 1) {  // Added a child, so -1
                updatedParentBountyResult = await bountyCollection.updateOne({ _id: new mongo.ObjectId(dbBountyResult._id) }, {
                    $set: {
                        // TODO is leaving DeletedBy empty OK? Can assume deletion happened automatically in that case
                        deletedAt: currentDate,
                        status: BountyStatus.deleted,
                    },
                    $push: {
                        statusHistory: {
                            status: BountyStatus.deleted,
                            setAt: currentDate,
                        },
                    }
                
                });
                if (updatedParentBountyResult == null) {
                    Log.error('failed to update evergreen bounty with deleted status');
                    throw new Error('Sorry something is not working, our devs are looking into it.');
                }
            }
        }
    } else {
        claimedBounty = dbBountyResult;
    }
 
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
            activityHistory: {
				activity: Activities.claim,
				modifiedAt: currentDate,
				client: Clients.bountybot,
			}
        },
    });

    if (writeResult.result.ok !== 1) {
        Log.error('failed to update claimed bounty with in progress status');
        throw new Error(`Write to database for bounty ${request.bountyId} failed for ${request.activity} `);
    }

    return claimedBounty;
}

export const claimBountyMessage = async (message: Message, claimedBounty: BountyCollection, createdByUser: GuildMember, claimedByUser: GuildMember, originalBounty: BountyCollection): Promise<any> => {
    Log.debug(`fetching bounty message for claim`)
    
    const existingEmbeds = message.embeds[0];
    const embedNewMessage: MessageEmbed = new MessageEmbed(existingEmbeds);

    // Send claimed bounty by DM
    embedNewMessage.fields[BountyEmbedFields.status].value = BountyStatus.in_progress;
    embedNewMessage.fields[BountyEmbedFields.bountyId].value = claimedBounty._id.toString();
    embedNewMessage.setTitle(await BountyUtils.createPublicTitle(<Bounty>claimedBounty));
    embedNewMessage.setURL(process.env.BOUNTY_BOARD_URL + claimedBounty._id.toString());
    embedNewMessage.setColor('#d39e00');
    embedNewMessage.addField('Claimed by', claimedByUser.user.tag, true);


    embedNewMessage.setFooter({text: '📮 - submit | 🆘 - help'});
    const claimantMessage: Message = await claimedByUser.send({ embeds: [embedNewMessage] });
    await addClaimantReactions(claimantMessage);

    embedNewMessage.setFooter({text: '✅ - complete'});
	const creatorMessage: Message = await createdByUser.send({ embeds: [embedNewMessage] });
	await addCreatorReactions(creatorMessage);

    // Evergreen: If Bounty status is no longer open, delete the board message, otherwise update title
    if (originalBounty.status !== BountyStatus.open) {
        await message.delete();
    } else {
        const embedOrigMessage: MessageEmbed = message.embeds[0];
        embedOrigMessage.setTitle(await BountyUtils.createPublicTitle(<Bounty>originalBounty));
        await message.edit({ embeds: [embedOrigMessage] });
    }
    await updateMessageStore(claimedBounty, claimantMessage, creatorMessage);

};

export const addClaimantReactions = async (message: Message): Promise<any> => {
    // await message.reactions.removeAll();
    await message.react('📮');
    await message.react('🆘');
};

export const addCreatorReactions = async (message: Message): Promise<any> => {
    // await message.reactions.removeAll();
    await message.react('✅');
};

// Save where we sent the Bounty message embeds for future updates
export const updateMessageStore = async (bounty: BountyCollection, claimantMessage: Message, creatorMessage: Message): Promise<any> => {
    const db: Db = await MongoDbUtils.connect('bountyboard');
    const bountyCollection = db.collection('bounties');
    const writeResult: UpdateWriteOpResult = await bountyCollection.updateOne({ _id: new mongo.ObjectId(bounty._id) }, {
        $set: {
            claimantMessage: {
                messageId: claimantMessage.id,
                channelId: claimantMessage.channelId,
            },
            creatorMessage: {
                messageId: creatorMessage.id,
                channelId: creatorMessage.channelId,
            },
        },
        $unset: { discordMessageId: "" },
    });
  
    if (writeResult.result.ok !== 1) {
        Log.error('failed to update claimed bounty record with message store');
        throw new Error(`Write to database for bounty ${bounty._id} failed. `);
    }

};
