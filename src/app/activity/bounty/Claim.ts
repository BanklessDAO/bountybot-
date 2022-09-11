import { GuildMember } from 'discord.js';
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
import ValidationError from '../../errors/ValidationError';
import TimeoutError from '../../errors/TimeoutError';
import { UpsertUserWalletRequest } from '../../requests/UpsertUserWalletRequest';
import { handler } from './Handler';
import RuntimeError from '../../errors/RuntimeError';
import ModalTimeoutError from '../../errors/ModalTimeoutError';

export const claimBounty = async (request: ClaimRequest): Promise<any> => {
    Log.debug('In Claim activity');
    
    if (! (await BountyUtils.userWalletRegistered(request.userId)) ) {
        console.log("Before wallet");
        const upsertWalletRequest = new UpsertUserWalletRequest({
            userDiscordId: request.userId,
            address: null,
            commandContext: request.commandContext,
            buttonInteraction: request.buttonInteraction,
            origRequest: request,
            callBack: finishClaim,
        })

        try {
            await handler(upsertWalletRequest);
        } catch (e) {
            if (e instanceof ValidationError) {
                console.log("Reply 1: activityResponse");
                await DiscordUtils.activityResponse(request.commandContext, request.buttonInteraction, `Unable to complete this operation.\n` +
                'Please try entering your wallet address with the command `/register-wallet` and then try claiming the bounty again.\n');
                return;
            }
            if (e instanceof ModalTimeoutError) {
                console.log("Reply 50: activityResponse");
                await DiscordUtils.activityResponse(request.commandContext, request.buttonInteraction, `Unable to complete this operation - form timeout.\n` +
                'Please try entering your wallet address with the command `/register-wallet` and then try claiming the bounty again.\n');
                return;
            }
            throw new RuntimeError(e);               
        }
    } else {
        await finishClaim(request);
    }

}

export const finishClaim = async (request: any) => {

    console.log("In finishClaim");

    // Check to make sure they didn't enter DELETE when putting in the wallet address
    if (!await BountyUtils.userWalletRegistered(request.userId)) {
        console.log("Reply 2: activityResponse");
        await DiscordUtils.activityResponse(request.commandContext, request.buttonInteraction, `You must enter a wallet address to claim a bounty.\n` +
        'Please try entering your wallet address with the command `/register-wallet` and then try claiming the bounty again.\n');
        return;
    }

    const claimedByUser = await DiscordUtils.getGuildMemberFromUserId(request.userId, request.guildId);
    Log.info(`${request.bountyId} bounty claimed by ${claimedByUser.user.tag}`);

    let getDbResult: {dbBountyResult: BountyCollection, bountyChannel: string} = await getDbHandler(request);

    let claimedBounty = getDbResult.dbBountyResult;
    let parentBounty: BountyCollection;
    //TODO: Test this again with modals in place
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
    console.log("Reply 3: activityNotification");
    await DiscordUtils.activityNotification(creatorNotification, createdByUser, claimedBountyCard.url);

    const claimaintResponse = `<@${claimedByUser.user.id}>, you have claimed this bounty! Reach out to <@${createdByUser.user.id}> with any questions.`;
    console.log("Reply 4: activityResponse");
    await DiscordUtils.activityResponse(request.commandContext, request.buttonInteraction, claimaintResponse, claimedBountyCard.url);
    
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
    console.log(`In writer ${JSON.stringify(dbBountyResult)}`);
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
 
    console.log(`Going to write ${JSON.stringify(claimedBounty)}`);
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

    console.log(`End writer ${JSON.stringify(writeResult)}`);

    if (writeResult.result.ok !== 1) {
        Log.error('failed to update claimed bounty with in progress status');
        throw new Error(`Write to database for bounty ${request.bountyId} failed for ${request.activity} `);
    }

    return { claimedBounty, parentBounty };
}

