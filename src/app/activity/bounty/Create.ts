import { Bounty } from '../../types/bounty/Bounty';
import Log from '../../utils/Log';
import { GuildMember, Role, MessageButton, MessageActionRow } from 'discord.js';
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
import { ComponentType, ModalInteractionContext, TextInputStyle } from 'slash-create';
import { AssignRequest } from '../../requests/AssignRequest';
import { assignBounty } from './Assign';

export const createBounty = async (createRequest: CreateRequest): Promise<any> => {
    Log.debug('In Create activity');

    if (createRequest.isIOU) {
        await finishCreate(createRequest, null, 'IOU for work already done', new Date(), null);
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
                    label: 'Tags',
                    style: TextInputStyle.SHORT,
                    max_length: 1000,
                    custom_id: 'tags',
                    placeholder: 'Comma separated list - e.g. L1, Marketing, Dev Guild',
                    required: false
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
                    placeholder: 'yyyy-mm-dd, or leave blank for 3 months from today',
                    required: false
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

    const tags = modalContext.values.tags;
    if (tags) {
        try {
            BountyUtils.validateTag(tags);
        } catch (e) {
            if (e instanceof ValidationError) {
                await modalContext.send({ content: `<@${guildMember.user.id}>\n` + e.message });
                return;
            }
        }
    }


    const dueAt = modalContext.values.dueAt;
    let convertedDueDateFromMessage: Date;
    if (!dueAt || (dueAt.toLowerCase() === 'no' || dueAt.toLowerCase() === 'skip')) {
        convertedDueDateFromMessage = BountyUtils.threeMonthsFromNow();
    } else {
        try {
            convertedDueDateFromMessage = BountyUtils.validateDate(dueAt);
        } catch (e) {
            Log.warn('user entered invalid date for bounty');
            await modalContext.send({ content: 'Please try `UTC` date in format `yyyy-mm-dd`, i.e 2021-08-15' });
            return;
        }
    }

    if (convertedDueDateFromMessage.toString() === 'Invalid Date') {
        Log.warn('user entered invalid date for bounty');
        await modalContext.send({ content: 'Please try `UTC` date in format `yyyy-mm-dd`, i.e 2021-08-15' });
        return;
    }

    await finishCreate(createRequest, description, criteria, convertedDueDateFromMessage, tags, modalContext);

}

export const finishCreate = async (createRequest: CreateRequest, description: string, criteria: string, dueAt: Date, tags: string, modalContext?: ModalInteractionContext) => {

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
        createRequest.createdInChannel,
        tags);

    Log.info(`user ${guildMember.user.tag} inserted bounty into db`);

    const cardMessage = await BountyUtils.canonicalCard(newBounty._id, createRequest.activity, await DiscordUtils.getTextChannelfromChannelId(newBounty.createdInChannel), guildMember);

    if (createRequest.isIOU) {
        // await createRequest.commandContext.sendFollowUp({ content: "Your IOU was created." } , { ephemeral: true });
        const IOUContent = `<@${owedTo.id}> An IOU was created for you by <@${guildMember.user.id}>:`;
        await DiscordUtils.activityNotification(IOUContent, owedTo, createRequest.guildId, cardMessage.url);

        const walletNeeded = !(await BountyUtils.userWalletRegistered(owedTo.id));

        if (walletNeeded) {
            // Note: ephemeral messagees are only visible to the user who kicked off the interaction,
            // so we can not send an ephemeral message to the owedTo user to check DMs

            const iouWalletMessage = `Please click the button below to enter your ethereum wallet address (non-ENS) to receive the reward amount for this bounty`;
            const walletButton = new MessageButton().setStyle('SECONDARY').setCustomId('👛').setLabel('Register Wallet');

            await DiscordUtils.attemptDM({ content: iouWalletMessage, components: [new MessageActionRow().addComponents(walletButton)] }, owedTo, createRequest.guildId);
        }

        await DiscordUtils.activityResponse(createRequest.commandContext, null, 'IOU created successfully.' + (walletNeeded ? "\n" +
        `${owedTo} has not registered a wallet. Remind them to check their DMs for a register wallet button, or to use the /register-wallet command.` : ""), createRequest.userId, createRequest.guildId);
    } else {
        await modalContext?.send('Bounty created, see below...');
        if (createRequest.assign) {
            const assignRequest = new AssignRequest({
                commandContext: null,
                messageReactionRequest: null,
                buttonInteraction: null,
                directRequest: {
                    guildId: createRequest.guildId,
                    bountyId: newBounty._id,
                    userId: createRequest.userId,
                    assign: createRequest.assign,
                    activity: Activities.assign,
                    bot: false,
                }
            });
            await assignBounty(assignRequest);
        }
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
    createdInChannel: string,
    tags: string
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
        createdInChannel,
        tags);


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
    createdInChannel: string,
    tags: string
): Promise<Bounty> => {

    Log.debug('generating bounty record');
    const [reward, symbol] = (createRequest.reward != null) ? createRequest.reward.split(' ') : [null, null];
    let scale = reward.split('.')[1]?.length;
    scale = (scale != null) ? scale : 0;
    const currentDate = (new Date()).toISOString();
    let status = BountyStatus.open;
    if (createRequest.isIOU) {
        status = BountyStatus.complete;
    }
    
    const bountyCreationChannel = await DiscordUtils.getTextChannelfromChannelId(createdInChannel);
    const bountyCreationChannelCategory = await DiscordUtils.getTextChannelfromChannelId(bountyCreationChannel.parentId as string);

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
        tags: {
            keywords:  tags ? tags.split(',')
            .map((word) => word.trim().toLowerCase())
            .filter((word) => word) : null,
            channelCategory: bountyCreationChannelCategory.name
        }
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

