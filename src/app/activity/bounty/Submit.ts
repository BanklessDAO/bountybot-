import mongo, { Db, UpdateWriteOpResult } from 'mongodb';
import MongoDbUtils from "../../utils/MongoDbUtils";
import Log from "../../utils/Log";
import BountyUtils from "../../utils/BountyUtils";
import DiscordUtils from "../../utils/DiscordUtils";
import { ButtonInteraction, GuildMember, ModalOptions, ModalSubmitInteraction } from "discord.js";
import { ComponentType, TextInputStyle, ModalInteractionContext, ModalOptions as scModalOptions, CommandContext } from "slash-create";
import RuntimeError from "../../errors/RuntimeError";
import ValidationError from "../../errors/ValidationError";
import ModalTimeoutError from "../../errors/ModalTimeoutError";
import { SubmitRequest } from "../../requests/SubmitRequest";
import { BountyCollection } from "../../types/bounty/BountyCollection";
import { BountyStatus } from "../../constants/bountyStatus";
import { CustomerCollection } from "../../types/bounty/CustomerCollection";

export const submitBounty = async (request: SubmitRequest): Promise<void> => {
    Log.debug('In Submit activity');

    // Different modal data types and calls in slash commands vs. button interactions
    const fromSlash = !!request.commandContext;

    const modal = {
        title: 'Submit Bounty For Review',
        components: [
        {
            type: (fromSlash ? ComponentType.ACTION_ROW : "ACTION_ROW"),
            components: [
            {
                type: (fromSlash ? ComponentType.TEXT_INPUT : "TEXT_INPUT"),
                label: 'Submission Notes',
                style: (fromSlash ? TextInputStyle.PARAGRAPH: "PARAGRAPH"),
                required: true,
                max_length: 4000,
                custom_id: 'submission_notes',
                placeholder: 'What you did, where the bounty creator can find your work, url, etc.',
                value: ""
            }]
        }]
    };

    // Check what we got in the modal, and if good store and respond
    const finishSubmit = async (request: SubmitRequest, context: ModalInteractionContext | ModalSubmitInteraction) => {

        try {
            BountyUtils.validateNotes(request.notes);
        } catch (e) {
            if (e instanceof ValidationError) {
                if (context instanceof ModalInteractionContext) {
                    await context.send(e.message);
                } else {
                    await context.reply({content: e.message, ephemeral: true});
                }
                return;
            } 
            throw new RuntimeError(e);               
        }

        // We have a new context to use after the modal for the response
        if (context instanceof ModalInteractionContext) {
            request.commandContext = context as unknown as CommandContext;
        } else {
            request.buttonInteraction = context as unknown as ButtonInteraction;
        }

        const getDbResult: {dbBountyResult: BountyCollection, bountyChannel: string} = await getDbHandler(request);
        // Since card may have been in a DM, guild might not be populated in the request
        if (request.guildId === undefined || request.guildId === null) {
            request.guildId = getDbResult.dbBountyResult.customerId;
        }
        const submittedByUser = await DiscordUtils.getGuildMemberFromUserId(request.userId, request.guildId);
        const createdByUser: GuildMember = await submittedByUser.guild.members.fetch(getDbResult.dbBountyResult.createdBy.discordId);
        Log.info(`${request.bountyId} bounty submitted by ${submittedByUser.user.tag}`);
    
        await writeDbHandler(request, submittedByUser);
    
        const cardMessage = await BountyUtils.canonicalCard(getDbResult.dbBountyResult._id, request.activity);
    
        let creatorSubmitDM = `Please reach out to <@${submittedByUser.user.id}>. They are ready for bounty review`
    
        if (request.notes) {
            creatorSubmitDM += `\nNotes included in submission:\n${request.notes}`
        }
        await DiscordUtils.activityNotification(creatorSubmitDM, createdByUser, cardMessage.url);
        await DiscordUtils.activityResponse(request.commandContext, request.buttonInteraction, `Bounty in review! Expect a message from <@${createdByUser.id}>.`, cardMessage.url);
        return;

    }

    // Callback for the slash modal version
    const modalCallback = async (modalContext: ModalInteractionContext, request: SubmitRequest) => {
        await modalContext.defer(true);
        request.notes = modalContext.values.submission_notes;
        await finishSubmit(request, modalContext);
    };

    // Call the modal. For slash command (slash-create), call the callback. For button interaction (discord.js), wait for submit and return. 

    if (fromSlash) {
        try {
            await request.commandContext.sendModal(modal as unknown as scModalOptions,async (mctx) => { await modalCallback(mctx, request) });
        } catch(e) {
            Log.error(e.message);
            throw new RuntimeError(e);
        }
        return;
    } else {
        const crypto = require('crypto');
        const uuid = crypto.randomUUID();
        try {
            await request.buttonInteraction.showModal(Object.assign(modal, {customId: uuid}) as unknown as ModalOptions);
        } catch(e) {
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
        request.notes = submittedInteraction.components[0].components[0].value;
        await finishSubmit(request, submittedInteraction);
       }
    
}
/**
 * Wraps read only calls to the database.
 * Intended to be replaced with calls to the API.
 * Note that the full customer read result is left out to be forward compatible with
 *     publishing bounties to a specified discord channel or multiple discord channels.
 *     This is b/c bountyChannel will be consumed from the bounty record at every step except Submit
 * @param request SubmitRequest, passed from activity initiator
 * @returns 
 */
const getDbHandler = async (request: SubmitRequest): Promise<{dbBountyResult: BountyCollection, bountyChannel: string}> => {
    const db: Db = await MongoDbUtils.connect('bountyboard');
	const bountyCollection = db.collection('bounties');
    const customerCollection = db.collection('customers');

	const dbBountyResult: BountyCollection = await bountyCollection.findOne({
		_id: new mongo.ObjectId(request.bountyId),
		status: BountyStatus.in_progress,
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
const writeDbHandler = async (request: SubmitRequest, submittedByUser: GuildMember): Promise<void> => {
    const db: Db = await MongoDbUtils.connect('bountyboard');
	const bountyCollection = db.collection('bounties');

	const dbBountyResult: BountyCollection = await bountyCollection.findOne({
		_id: new mongo.ObjectId(request.bountyId),
		status: BountyStatus.in_progress,
	});

	const currentDate = (new Date()).toISOString();
	const writeResult: UpdateWriteOpResult = await bountyCollection.updateOne(dbBountyResult, {
		$set: {
			submittedBy: {
				discordHandle: submittedByUser.user.tag,
				discordId: submittedByUser.user.id,
				iconUrl: submittedByUser.user.avatarURL(),
			},
			submittedAt: currentDate,
			status: BountyStatus.in_review,
			submissionNotes: request.notes,
		},
		$push: {
			statusHistory: {
				status: BountyStatus.in_review,
				setAt: currentDate,
			},
		},
	});

    if (writeResult.result.ok !== 1) {
        Log.error(`Write result did not execute correctly`);
        throw new Error(`Write to database for bounty ${request.bountyId} failed for Submit `);
    }
}
