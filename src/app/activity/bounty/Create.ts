import { Bounty } from '../../types/bounty/Bounty';
import Log from '../../utils/Log';
import { Message, GuildMember, DMChannel, Role } from 'discord.js';
import DiscordUtils from '../../utils/DiscordUtils';
import BountyUtils from '../../utils/BountyUtils';
import MongoDbUtils from '../../utils/MongoDbUtils';
import { Db, Double, Int32 } from 'mongodb'
import ValidationError from '../../errors/ValidationError';
import { CreateRequest } from '../../requests/CreateRequest';
import { BountyStatus } from '../../constants/bountyStatus';
import { Clients } from '../../constants/clients';
import { PaidStatus } from '../../constants/paidStatus';
import { Activities } from '../../constants/activities';
import TimeoutError from '../../errors/TimeoutError';
import ConflictingMessageException from '../../errors/ConflictingMessageException';
import DMPermissionError from '../../errors/DMPermissionError';
import { ComponentType, ModalInteractionContext, TextInputStyle } from 'slash-create';

export const createBounty = async (createRequest: CreateRequest): Promise<any> => {
    Log.debug('In Create activity');

    if (createRequest.isIOU) {
        await finishCreate(createRequest, null, 'IOU for work already done', new Date());
    } else {
        await createRequest.commandContext.sendModal(      {
            title: 'New Bounty Detail',
            //custom_id: dbInsertResult.insertedId,
            components: [
              {
                type: ComponentType.ACTION_ROW,
                components: [
                  {
                    type: ComponentType.TEXT_INPUT,
                    label: 'Description',
                    style: TextInputStyle.PARAGRAPH,
                    max_length: 4000,
                    custom_id: 'description',
                    placeholder: 'Description of your bounty'
                  }
                ]
              },
              {
                type: ComponentType.ACTION_ROW,
                components: [
                  {
                    type: ComponentType.TEXT_INPUT,
                    label: 'Criteria',
                    style: TextInputStyle.PARAGRAPH,
                    max_length: 1000,
                    custom_id: 'criteria',
                    placeholder: 'What needs to be done for this bounty to be completed'
                  }
                ]
              },
              {
                type: ComponentType.ACTION_ROW,
                components: [
                  {
                    type: ComponentType.TEXT_INPUT,
                    label: 'Due Date',
                    style: TextInputStyle.SHORT,
                    custom_id: 'dueAt',
                    placeholder: 'yyyy-mm-dd, or \'no\' or \'skip\' for 3 months from today'
                  }
                ]
              }
            ]
          },async (mctx) => { await modalCallback(mctx, createRequest) })
    }
}

export const modalCallback = async (modalContext: ModalInteractionContext, createRequest: CreateRequest) => {

    await modalContext.defer(true);

    const guildAndMember = await DiscordUtils.getGuildAndMember(createRequest.guildId, createRequest.userId);
    const guildMember: GuildMember = guildAndMember.guildMember;

    const description = modalContext.values.description;
    try {
        BountyUtils.validateDescription(description);
    } catch (e) {
        if (e instanceof ValidationError) {
            await modalContext.send({ content: `<@${guildMember.user.id}>\n` + e.message })
            return;
        }
    }

    const criteria = modalContext.values.criteria;
    try {
        BountyUtils.validateCriteria(criteria);
    } catch (e) {
        if (e instanceof ValidationError) {
            await modalContext.send({ content: `<@${guildMember.user.id}>\n` + e.message });
            return;
        }
    }

    const dueAt = modalContext.values.dueAt;
    let convertedDueDateFromMessage: Date;
    if (!(dueAt.toLowerCase() === 'no' || dueAt.toLowerCase() === 'skip')) {
        try {
            convertedDueDateFromMessage = BountyUtils.validateDate(dueAt);
        } catch (e) {
            Log.warn('user entered invalid date for bounty');
            await modalContext.send({ content: 'Please try `UTC` date in format `yyyy-mm-dd`, i.e 2021-08-15' });
            return;
        }
    } else if (dueAt.toLowerCase() === 'no' || dueAt.toLowerCase() === 'skip') {
        convertedDueDateFromMessage = BountyUtils.threeMonthsFromNow();
    }

    if (convertedDueDateFromMessage.toString() === 'Invalid Date') {
        Log.warn('user entered invalid date for bounty');
        await modalContext.send({ content: 'Please try `UTC` date in format `yyyy-mm-dd`, i.e 2021-08-15' });
        return;
    }

    await finishCreate(createRequest, description, criteria, convertedDueDateFromMessage, modalContext);

}

export const finishCreate = async (createRequest: CreateRequest, description: string, criteria: string, dueAt: Date, modalContext?: ModalInteractionContext) => {

    const guildAndMember = await DiscordUtils.getGuildAndMember(createRequest.guildId, createRequest.userId);
    const guildMember: GuildMember = guildAndMember.guildMember;
    const owedTo = createRequest.isIOU ? await DiscordUtils.getGuildMemberFromUserId(createRequest.owedTo, createRequest.guildId) : null;

    const newBounty = await createDbHandler(
        createRequest,
        description,
        criteria,
        dueAt,
        guildMember,
        owedTo,
        createRequest.createdInChannel);

    Log.info(`user ${guildMember.user.tag} inserted bounty into db`);

    const cardMessage = await BountyUtils.canonicalCard(newBounty._id, createRequest.activity, await DiscordUtils.getTextChannelfromChannelId(newBounty.createdInChannel), guildMember, modalContext);

    if (createRequest.isIOU) {
        // await createRequest.commandContext.sendFollowUp({ content: "Your IOU was created." } , { ephemeral: true });
        const IOUContent = `<@${owedTo.id}> An IOU was created for you by <@${guildMember.user.id}>: ${cardMessage.url}`;
        await owedTo.send({ content: IOUContent }).catch(() => { throw new DMPermissionError(IOUContent) });

        if (!(await BountyUtils.userWalletRegistered(owedTo.id))) {
            // Note: ephemeral messagees are only visible to the user who kicked off the interaction,
            // so we can not send an ephemeral message to the owedTo user to check DMs

            const durationMinutes = 5;
            const iouWalletMessage = `Hello <@${owedTo.id}>!\n` +
                `Please respond within ${durationMinutes} minutes.\n` +
                `Please enter the ethereum wallet address (non-ENS) to receive the reward amount for this bounty`;
            const walletNeededMessage: Message = await owedTo.send({ content: iouWalletMessage });
            const dmChannel: DMChannel = await walletNeededMessage.channel.fetch() as DMChannel;

            await createRequest.commandContext.send({ content: `Waiting for <@${owedTo.id}> to enter their wallet address.`, ephemeral: true });

            try {
                await BountyUtils.userInputWalletAddress(dmChannel, owedTo.id, durationMinutes * 60 * 1000);
                await createRequest.commandContext.delete();
            }
            catch (e) {
                if (e instanceof TimeoutError || e instanceof ValidationError) {
                    await owedTo.send(
                        `Unable to complete this operation due to timeout or incorrect wallet addresses.\n` +
                        'Please try entering your wallet address with the slash command `/register-wallet`.\n\n' +
                        `Return to Bounty list: ${(await BountyUtils.getLatestCustomerList(createRequest.guildId))}`
                    );
                    await createRequest.commandContext.editOriginal({
                        content:
                            `<@${createRequest.userId}>:\n` +
                            `<@${owedTo.id}> was unable to enter their wallet address.\n` +
                            `Collecting wallet addresses of contributors can take up to a few days.\n` +
                            `To facilitate ease of payment when this bounty is completed, please remind <@${owedTo.id}> ` +
                            'to register their wallet address with the slash command `/register wallet`\n'
                    });
                }
                if (e instanceof ConflictingMessageException) {
                    await walletNeededMessage.delete();
                }
            }
        }

        await DiscordUtils.activityResponse(createRequest.commandContext, null, 'IOU created successfully');
    } else {
        await modalContext?.send('Bounty created, see below...');
        return;
    }
}

const createDbHandler = async (
    createRequest: CreateRequest,
    description: string,
    criteria: string,
    dueAt: Date,
    guildMember: GuildMember,
    owedTo: GuildMember,
    createdInChannel: string
): Promise<Bounty> => {
    const db: Db = await MongoDbUtils.connect('bountyboard');
    const dbBounty = db.collection('bounties');

    const assignedTo: GuildMember = createRequest.assign ? await DiscordUtils.getGuildMemberFromUserId(createRequest.assign, createRequest.guildId) : null;

    const gatedTo: Role = createRequest.gate ? await DiscordUtils.getRoleFromRoleId(createRequest.gate, createRequest.guildId) : null;

    const createdBounty: Bounty = await generateBountyRecord(
        createRequest,
        description,
        criteria,
        dueAt,
        guildMember,
        owedTo,
        assignedTo,
        gatedTo,
        createdInChannel);


    const dbInsertResult = await dbBounty.insertOne(createdBounty);
    if (dbInsertResult == null) {
        Log.error('failed to insert bounty into DB');
        throw new Error('Sorry something is not working, our devs are looking into it.');
    }

    return createdBounty;

}

export const generateBountyRecord = async (
    createRequest: CreateRequest,
    description: string,
    criteria: string,
    dueAt: Date,
    guildMember: GuildMember,
    owedTo: GuildMember,
    assignedTo: GuildMember,
    gatedTo: Role,
    createdInChannel: string
): Promise<Bounty> => {

    Log.debug('generating bounty record')
    const [reward, symbol] = (createRequest.reward != null) ? createRequest.reward.split(' ') : [null, null];
    let scale = reward.split('.')[1]?.length;
    scale = (scale != null) ? scale : 0;
    const currentDate = (new Date()).toISOString();
    let status = BountyStatus.draft;
    if (createRequest.isIOU) {
        status = BountyStatus.complete;
    }

    let bountyRecord: Bounty = {
        customerId: createRequest.guildId,
        title: createRequest.title,
        description: description,
        criteria: criteria,
        reward: {
            currency: symbol.toUpperCase(),
            amount: new Double(parseFloat(reward)),
            scale: new Int32(scale),
        },
        createdBy: {
            discordHandle: guildMember.user.tag,
            discordId: guildMember.user.id,
            iconUrl: guildMember.user.avatarURL(),
        },
        createdAt: currentDate,
        createdInChannel: createdInChannel,
        statusHistory: [
            {
                status: status,
                setAt: currentDate,
            },
        ],
        activityHistory: [
            {
                activity: Activities.create,
                modifiedAt: currentDate,
                client: Clients.bountybot,
            }
        ],
        status: status,
        paidStatus: PaidStatus.unpaid,
        dueAt: dueAt ? dueAt.toISOString() : null,
    };

    if (createRequest.gate) {
        bountyRecord.gateTo = [{discordId: gatedTo.id, discordName: gatedTo.name, iconUrl: gatedTo.iconURL()}];
    }

    if (createRequest.evergreen) {
        bountyRecord.evergreen = true;
        bountyRecord.isParent = true;
        if (createRequest.claimLimit !== undefined) {
            bountyRecord.claimLimit = createRequest.claimLimit;
        }
    }

    if (createRequest.assign) {
        bountyRecord.assignTo = {
            discordId: assignedTo.user.id,
            discordHandle: assignedTo.user.tag,
            iconUrl: assignedTo.user.avatarURL(),
        }
    }

    if (createRequest.requireApplication) {
        bountyRecord.requireApplication = true;
    }

    if (createRequest.isIOU) {
        bountyRecord.isIOU = true;
        bountyRecord.claimedBy = {
            discordHandle: owedTo.user.tag,
            discordId: owedTo.user.id,
            iconUrl: owedTo.user.avatarURL(),
        };
        bountyRecord.reviewedBy = {
            discordHandle: guildMember.user.tag,
            discordId: guildMember.user.id,
            iconUrl: guildMember.user.avatarURL(),
        };
    }

    return bountyRecord;
};

