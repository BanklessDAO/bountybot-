import { GuildMember, ModalSubmitInteraction, ModalOptions, ButtonInteraction } from 'discord.js';
import { ApplyRequest } from '../../requests/ApplyRequest';
import { BountyCollection } from '../../types/bounty/BountyCollection';
import DiscordUtils from '../../utils/DiscordUtils';
import ValidationError from '../../errors/ValidationError';
import Log from '../../utils/Log';
import mongo, { Db, UpdateWriteOpResult } from 'mongodb';
import MongoDbUtils from '../../utils/MongoDbUtils';
import { CustomerCollection } from '../../types/bounty/CustomerCollection';
import BountyUtils from '../../utils/BountyUtils';
import { ModalOptions as scModalOptions, ComponentType, ModalInteractionContext, TextInputStyle } from 'slash-create';
import RuntimeError from '../../errors/RuntimeError';
import ModalTimeoutError from '../../errors/ModalTimeoutError';

export const applyBounty = async (request: ApplyRequest): Promise<any> => {
    Log.debug('In Apply activity');

    // Different modal data types and calls in slash commands vs. button interactions
    const fromSlash = !!request.commandContext;

    const modal = {
        title: 'What\'s your pitch?',
        components: [
        {
            type: (fromSlash ? ComponentType.ACTION_ROW : "ACTION_ROW"),
            components: [
            {
                type: (fromSlash ? ComponentType.TEXT_INPUT : "TEXT_INPUT"),
                label: 'Pitch',
                style: (fromSlash ? TextInputStyle.PARAGRAPH: "PARAGRAPH"),
                max_length: 4000,
                required: true,
                custom_id: 'pitch',
                placeholder: 'Why should this bounty be assigned to you?'
            }]
        }]
    };

    // Callback for the slash version
    const modalCallback = async (modalContext: ModalInteractionContext, request: any) => {

        await modalContext.defer(true);
        const pitch = modalContext.values.pitch;
        try {
            BountyUtils.validatePitch(pitch);
        } catch (e) {
            if (e instanceof ValidationError) {
                await modalContext.send(e.message);
                return;
            } 
            throw new RuntimeError(e);               
        }

        await modalContext.send('Pitch accepted');

        await finishApply(request, pitch);
    };

    // Call the modal. For slash command, call the callback. For button interaction, wait for submit and then finish. 

    if (fromSlash) {
        await request.commandContext.sendModal(modal as scModalOptions ,async (mctx) => { await modalCallback(mctx, request) });
        return;
    } else {
        const crypto = require('crypto');
        const uuid = crypto.randomUUID();
        try {
            await request.buttonInteraction.showModal(Object.assign(modal as unknown as ModalOptions, {customId: uuid}));
        } catch(e) {
            console.log(e.message)
            return;
        }
        const submittedInteraction = (await request.buttonInteraction.awaitModalSubmit({
            time: 60000,
            filter: i => (i.user.id === request.userId) && (i.customId === uuid),
            }).catch(e => {
                // Most likely a modal timeout
                throw new ModalTimeoutError(e);
            })) as ModalSubmitInteraction;
        const pitch = submittedInteraction.components[0].components[0].value;
        try {
            BountyUtils.validatePitch(pitch);
        } catch (e) {
            if (e instanceof ValidationError) {
                await submittedInteraction.reply({content: e.message, ephemeral: true});
                return;
            } 
            throw new RuntimeError(e);               
        }

        // We have a new interaction, use that for the request reponse.
        request.buttonInteraction = submittedInteraction as unknown as ButtonInteraction;

        await finishApply(request, pitch);
    }
}

export const finishApply = async (request: ApplyRequest, pitch: string) => {
    const applyingUser = await DiscordUtils.getGuildMemberFromUserId(request.userId, request.guildId);
    Log.info(`${request.bountyId} bounty applied for by ${applyingUser.user.tag}`);
    
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

