import { GuildMember, Message, DMChannel } from 'discord.js';
import { ClaimRequest } from '../../requests/ClaimRequest';
import { BountyCollection } from '../../types/bounty/BountyCollection';
import DiscordUtils from '../../utils/DiscordUtils';
import Log from '../../utils/Log';
import mongo, { Db, UpdateWriteOpResult } from 'mongodb';
import MongoDbUtils from '../../utils/MongoDbUtils';
import { CustomerCollection } from '../../types/bounty/CustomerCollection';
import { BountyStatus } from '../../constants/bountyStatus';
import BountyUtils from '../../utils/BountyUtils';
import { Activities } from '../../constants/activities';
import { Clients } from '../../constants/clients';
import { UserCollection } from '../../types/user/UserCollection';
import ValidationError from '../../errors/ValidationError';
import TimeoutError from '../../errors/TimeoutError';
import DMPermissionError from '../../errors/DMPermissionError';

export const claimBounty = async (request: ClaimRequest): Promise<any> => {
    Log.debug('In Claim activity');

    const claimedByUser = await DiscordUtils.getGuildMemberFromUserId(request.userId, request.guildId);
    Log.info(`${request.bountyId} bounty claimed by ${claimedByUser.user.tag}`);

    if (! (await BountyUtils.isUserWalletRegistered(request.userId))) {
        const gotoDMMessage = 'Go to your DMs to finish claiming the bounty...';
        await DiscordUtils.activityResponse(request.commandContext, request.buttonInteraction, gotoDMMessage);
        
        const durationMinutes = 2;
        const claimWalletMessage = `Hello <@${request.userId}>!\n` +
            `Please respond within 2 minutes.\n` +
            `To claim this bounty, please enter the ethereum wallet address (non-ENS) to receive the reward amount for this bounty`;
        const walletNeededMessage: Message = await claimedByUser.send({ content: claimWalletMessage }).catch(() => { throw new DMPermissionError(claimWalletMessage) });
        const dmChannel: DMChannel = await walletNeededMessage.channel.fetch() as DMChannel;
        
        try {
            await BountyUtils.userInputWalletAddress(dmChannel, request.userId, durationMinutes*60*1000);
        }
        catch (e) {
            if (e instanceof TimeoutError || e instanceof ValidationError) {
                throw new ValidationError(                
                    `Unable to complete this operation.\n` +
                    'Please try entering your wallet address with the slash command `/register wallet` and then try claiming the bounty again.\n\n' +
                    `Return to Bounty list: ${(await BountyUtils.getLatestCustomerList(request.guildId))}`
                    );
            }
        }
    }

    let getDbResult: {dbBountyResult: BountyCollection, bountyChannel: string} = await getDbHandler(request);

    let claimedBounty = getDbResult.dbBountyResult;
    let parentBounty: BountyCollection;
    if (!request.clientSyncRequest) {
        const writeResult = await writeDbHandler(request, getDbResult.dbBountyResult, claimedByUser);
        claimedBounty = writeResult.claimedBounty;
        parentBounty = writeResult.parentBounty;
    }

    // If we are dealing with a multi-claimant, make sure child card goes in correct channel
    const parentBountyChannel = !parentBounty || !parentBounty.canonicalCard ? undefined : await DiscordUtils.getTextChannelfromChannelId(parentBounty.canonicalCard.channelId);
    const claimedBountyCard = await BountyUtils.canonicalCard(claimedBounty._id, request.activity, parentBountyChannel);

    let creatorNotification = 
    `Your bounty has been claimed by <@${claimedByUser.user.id}> \n` +
    `You are free to mark this bounty as complete and/or paid at any time.\n` +
    `Marking a bounty as complete and/or paid may help you with accounting or project status tasks later on.`;
    if (getDbResult.dbBountyResult.evergreen) {
        const parentBountyUrl = process.env.BOUNTY_BOARD_URL + parentBounty._id;
        const parentBountyCard = await BountyUtils.canonicalCard(parentBounty._id, request.activity);
        if (parentBounty.status == BountyStatus.open) {
            creatorNotification += `\nSince you marked your original bounty as multi-claimant, it will stay on the board as Open. <${parentBountyCard.url}>`;
        } else {
            creatorNotification += `\nYour multi-claimant bounty has reached its claim limit and has been marked deleted. <${parentBountyUrl}>`;
            await parentBountyCard.delete();
        }
    }

    const createdByUser = await DiscordUtils.getGuildMemberFromUserId(getDbResult.dbBountyResult.createdBy.discordId, request.guildId);
    await DiscordUtils.activityNotification(creatorNotification, createdByUser, claimedBountyCard.url);

    const claimaintResponse = `<@${claimedByUser.user.id}>, you have claimed this bounty! Reach out to <@${createdByUser.user.id}> with any questions: <${claimedBountyCard.url}>`;
    await DiscordUtils.activityResponse(request.commandContext, request.buttonInteraction, claimaintResponse);
    
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

const writeDbHandler = async (request: ClaimRequest, dbBountyResult: BountyCollection, claimedByUser: GuildMember): Promise<{claimedBounty: BountyCollection, parentBounty: BountyCollection}> => {
    const db: Db = await MongoDbUtils.connect('bountyboard');
    const bountyCollection = db.collection('bounties');
    let claimedBounty: BountyCollection;
    let parentBounty: BountyCollection;
    const currentDate = (new Date()).toISOString();

    // If claiming an evergreen bounty, create a copy and use that
    if (dbBountyResult.evergreen) {
        const childBounty: BountyCollection = Object.assign({}, dbBountyResult);
        childBounty.parentId = childBounty._id;
        delete childBounty._id;
        delete childBounty.isParent;
        delete childBounty.childrenIds;
        delete childBounty.claimLimit;
        delete childBounty.canonicalCard;
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

        // Pull it back to refresh our copy
        parentBounty = await bountyCollection.findOne({
            _id: new mongo.ObjectId(dbBountyResult._id)
         });
    

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

    return { claimedBounty, parentBounty };
}

