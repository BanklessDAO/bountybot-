import { DeleteRequest } from '../../requests/DeleteRequest';
import DiscordUtils from '../../utils/DiscordUtils';
import Log, { LogUtils } from '../../utils/Log';
import { ButtonInteraction, GuildMember, ModalOptions, ModalSubmitInteraction, TextChannel } from 'discord.js';
import MongoDbUtils from '../../utils/MongoDbUtils';
import mongo, { Db, UpdateWriteOpResult } from 'mongodb';
import { BountyCollection } from '../../types/bounty/BountyCollection';
import RuntimeError from '../../errors/RuntimeError';
import { BountyStatus } from '../../constants/bountyStatus';
import { CommandContext, ComponentType, ModalOptions as scModalOptions, ModalInteractionContext, TextInputStyle } from 'slash-create';
import crypto from 'crypto';
import ModalTimeoutError from '../../errors/ModalTimeoutError';
import BountyUtils from '../../utils/BountyUtils';
import DMPermissionError from '../../errors/DMPermissionError';

export const deleteBounty = async (request: DeleteRequest): Promise<void> => {
    Log.debug('In Delete activity');

    // Came in just to delete a bounty. Don't ask questions or resolve interactions. Send DM instead
    if (request.silent) {
        await finishDelete(request);
        return;
    }

    const bounty: BountyCollection = await getDbHandler(request.bountyId);

    if (bounty.repeatTemplateId) {

        const templateBounty: BountyCollection = await getDbHandler(bounty.repeatTemplateId);

        // If template for this bounty is still active, ask if it should also be deleted (ending future repeats)
        if (templateBounty.status != BountyStatus.deleted) {

            // Different modal data types and calls in slash commands vs. button interactions
            const fromSlash = !!request.commandContext;

            const modal = {
                title: 'Repeating Bounty',
                components: [
                    {
                        type: (fromSlash ? ComponentType.ACTION_ROW : "ACTION_ROW"),
                        components: [
                            {
                                type: (fromSlash ? ComponentType.TEXT_INPUT : "TEXT_INPUT"),
                                label: "Bounty repeats. Stop all future repeats?",
                                style: (fromSlash ? TextInputStyle.SHORT : "SHORT"),
                                required: true,
                                max_length: 20,
                                custom_id: 'delete_response',
                                placeholder: 'Enter YES to stop future repeats.',
                                value: "NO"
                            }]
                    }]
            };

            // Check what we got in the modal, and if Yes, delete the template and respond
            const deleteRepeats = async (request: DeleteRequest, context: ModalInteractionContext | ModalSubmitInteraction, deleteResponse: string) => {

                // We have a new context to use after the modal for the response
                if (context instanceof ModalInteractionContext) {
                    request.commandContext = context as unknown as CommandContext;
                } else {
                    request.buttonInteraction = context as unknown as ButtonInteraction;
                }

                if (deleteResponse.toUpperCase() == "YES") {
                    const deletedByUser = await DiscordUtils.getGuildMemberFromUserId(request.userId, request.guildId);
                    const bounty: BountyCollection = await getDbHandler(request.bountyId);
                    await writeDbHandler(null, deletedByUser, bounty.repeatTemplateId);

                    const response = "Bounty will no longer repeat";
                    if (context instanceof ModalInteractionContext) {
                        await context.send(response);
                    } else {
                        await context.reply({ content: response, ephemeral: true });
                    }
                    Log.info(`${bounty.repeatTemplateId} repeating template bounty deleted by ${deletedByUser.user.tag}`);
                } else {
                    const response = "Bounty will continue to repeat";
                    if (context instanceof ModalInteractionContext) {
                        await context.send(response);
                    } else {
                        await context.reply({ content: response, ephemeral: true });
                    }
                }

                await finishDelete(request);
                return;

            }

            // Callback for the slash modal version
            const modalCallback = async (modalContext: ModalInteractionContext, request: DeleteRequest) => {
                await modalContext.defer(true);
                await deleteRepeats(request, modalContext, modalContext.values.delete_response);
            };

            // Call the modal. For slash command (slacsh-create), call the callback. For button interaction (discord.js), wait for submit and return. 

            if (fromSlash) {
                try {
                    await request.commandContext.sendModal(modal as unknown as scModalOptions, async (mctx) => { await modalCallback(mctx, request) });
                } catch (e) {
                    Log.error(e.message);
                    throw new RuntimeError(e);
                }
                return;
            } else {
                const uuid = crypto.randomUUID();
                try {
                    await request.buttonInteraction.showModal(Object.assign(modal, { customId: uuid }) as unknown as ModalOptions);
                } catch (e) {
                    Log.error(e.message);
                    throw new RuntimeError(e);
                }
                const submittedInteraction = await request.buttonInteraction.awaitModalSubmit({
                    time: 60000,
                    filter: i => (i.user.id === request.userId) && (i.customId === uuid),
                }).catch(e => {
                    Log.info(`<@${request.userId}> had a modal error ${e.message}`);
                    // Most likely a modal form timeout error
                    throw new ModalTimeoutError(e);
                }) as ModalSubmitInteraction;
                const deleteResponse = submittedInteraction.components[0].components[0].value;
                await deleteRepeats(request, submittedInteraction, deleteResponse);
            }
        } else {
            await finishDelete(request);
        }
    } else {
        await finishDelete(request);
    }
}

export const finishDelete = async (request: DeleteRequest) => {

    const bounty: BountyCollection = await getDbHandler(request.bountyId);

    let creatorDeleteDM = "";

    if (request.silent || BountyUtils.validateDeletableStatus(bounty)) {
        const deletedByUser = await DiscordUtils.getGuildMemberFromUserId(request.userId, request.guildId);
        Log.info(`${request.bountyId} bounty deleted by ${deletedByUser.user.tag}`);

        await writeDbHandler(request, deletedByUser);

        // The cron job is deleting an expired repeating bounty
        if (bounty.isRepeatTemplate) {
            creatorDeleteDM += `Repeating bounty \"${bounty.title}\", ID: ${bounty._id}, has reached its `;
            if (bounty.numRepeats) {
                creatorDeleteDM += `limit of ${bounty.numRepeats} repeats `;
            } else {
                creatorDeleteDM += `end date of ${(new Date(bounty.endRepeatsDate)).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} `;
            }
            creatorDeleteDM += 'and has been deleted.';
        } else {
            const bountyUrl = process.env.BOUNTY_BOARD_URL + request.bountyId;
            // The cron job is deleting an unclaimed repeat
            if (request.silent && bounty.repeatTemplateId && (bounty.status == BountyStatus.open)) {
                creatorDeleteDM = `The following repeated bounty was unclaimed, and was therefore deleted: <${bountyUrl}>\n`;
            } else {
                const bountyChannel: TextChannel = await DiscordUtils.getTextChannelfromChannelId(bounty.canonicalCard.channelId);
                const bountyEmbedMessage = await DiscordUtils.getMessagefromMessageId(bounty.canonicalCard.messageId, bountyChannel).catch(e => {
                    LogUtils.logError(`could not find bounty ${request.bountyId} in discord #bounty-board channel ${bountyChannel.id} in guild ${request.guildId}`, e);
                    //throw new RuntimeError(e);
                });

                if (bountyEmbedMessage) await bountyEmbedMessage.delete();

                creatorDeleteDM =
                    `The following bounty has been deleted: <${bountyUrl}>\n`;
            }
            if (bounty.evergreen && bounty.isParent &&
                bounty.childrenIds !== undefined && bounty.childrenIds.length > 0) {
                creatorDeleteDM += 'Children bounties created from this multi-claimant bounty will remain.\n';
            }
        }
    } else {
        creatorDeleteDM =
            `The bounty id you have selected is in status ${bounty.status}\n` +
            `Currently, only bounties with status ${BountyStatus.draft} and ${BountyStatus.open} can be deleted.\n` +
            `Please reach out to your favorite Bounty Board representative with any questions!`;
    }

    if (request.silent) {
        const guildAndMember = await DiscordUtils.getGuildAndMember(request.guildId, bounty.createdBy.discordId);
        const guildMember: GuildMember = guildAndMember.guildMember;
        await guildMember.send({ content: creatorDeleteDM }).catch(() => { throw new DMPermissionError(creatorDeleteDM) });
    } else {    
        await DiscordUtils.activityResponse(request.commandContext, request.buttonInteraction, creatorDeleteDM);
    }
    return;
}

const getDbHandler = async (bountyId: string): Promise<BountyCollection> => {
    const db: Db = await MongoDbUtils.connect('bountyboard');
    const bountyCollection = db.collection('bounties');
    const customerCollection = db.collection('customers');

    const dbBountyResult: BountyCollection = await bountyCollection.findOne({
        _id: new mongo.ObjectId(bountyId),
    });

    return dbBountyResult;

}

// TODO: consider adding the previous read result as a parameter to save a db read
const writeDbHandler = async (request: DeleteRequest, deletedByUser: GuildMember, bountyId?: string): Promise<void> => {
    const db: Db = await MongoDbUtils.connect('bountyboard');
    const bountyCollection = db.collection('bounties');

    const dbBountyResult: BountyCollection = await bountyCollection.findOne({
        _id: new mongo.ObjectId(request?.bountyId || bountyId),
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
            resolutionNote: request?.resolutionNote,
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
        throw new Error(`Write to database for bounty ${request?.bountyId || bountyId} failed for Delete `);
    }
}
