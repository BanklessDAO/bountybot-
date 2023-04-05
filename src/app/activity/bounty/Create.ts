import { Bounty } from '../../types/bounty/Bounty';
import Log from '../../utils/Log';
import { GuildMember, Role, MessageButton, MessageActionRow, ModalOptions } from 'discord.js';
import DiscordUtils from '../../utils/DiscordUtils';
import BountyUtils from '../../utils/BountyUtils';
import MongoDbUtils from '../../utils/MongoDbUtils';
import mongo, { Db, Double, Int32 } from 'mongodb'
import ValidationError from '../../errors/ValidationError';
import { CreateRequest } from '../../requests/CreateRequest';
import { BountyStatus } from '../../constants/bountyStatus';
import { Clients } from '../../constants/clients';
import { PaidStatus } from '../../constants/paidStatus';
import { Activities } from '../../constants/activities';
import DMPermissionError from '../../errors/DMPermissionError';
import { ComponentType, ModalOptions as scModalOptions, ModalInteractionContext, TextInputStyle, ComponentActionRow } from 'slash-create';
import { BountyCollection } from '../../types/bounty/BountyCollection';

export const createBounty = async (createRequest: CreateRequest): Promise<any> => {
    Log.debug('In Create activity');

    if (createRequest.templateId) {
        // If we have a templateId, this came from the background cron job creating repeating bounties. Load everything and go create
        const db: Db = await MongoDbUtils.connect('bountyboard');
        const dbBounty = db.collection('bounties');
        const template: BountyCollection = await dbBounty.findOne({ '_id': new mongo.ObjectId(createRequest.templateId) });
        // Calculate the new due date
        const now = new Date();
        const templateCreatedAt = new Date(template.createdAt);
        const templateDueAt = new Date(template.dueAt);
        const dueAtOffset = templateDueAt.getTime() - templateCreatedAt.getTime();
        const dueAtTime = now.getTime() + dueAtOffset;
        const dueAt = new Date(dueAtTime);

        const endRepeatsDate = template.endRepeatsDate ? new Date(template.endRepeatsDate) : null;
        await finishCreate(createRequest, template.description, template.criteria, dueAt, template.tags?.keywords?.join(','), template.numRepeats, endRepeatsDate);
    } else {
        const repeatEndModal: ComponentActionRow = createRequest.repeatDays ? {
            type: ComponentType.ACTION_ROW,
            components: [
                {
                    type: ComponentType.TEXT_INPUT,
                    label: '# of Repeats or End Date',
                    style: TextInputStyle.SHORT,
                    custom_id: 'endNumOrDate',
                    placeholder: `Enter an integer, or YYYY-MM-DD. Leave blank for 3 months`,
                    required: false
                }
            ]
        } : null;

        if (createRequest.isIOU) {
            if (createRequest.repeatDays) {
                const modalData: scModalOptions = {
                    title: 'Repeating IOU',
                    components: [repeatEndModal]
                }
                await createRequest.commandContext.sendModal(modalData, async (mctx) => { await modalCallback(mctx, createRequest) });
            } else {
                await finishCreate(createRequest, null, 'IOU for work already done', new Date(), null);
            }
        } else {
            let dueDateMessage = 'yyyy-mm-dd, or leave blank for 3 months from today';
            const modalData: scModalOptions = {
                title: 'New Bounty Detail',
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
                                placeholder: dueDateMessage,
                                required: false
                            }
                        ]
                    }
                ]
            };

            if (createRequest.repeatDays) {
                modalData.components.push(repeatEndModal);
            }

            await createRequest.commandContext.sendModal(modalData, async (mctx) => { await modalCallback(mctx, createRequest) })
        }
    }
}

export const modalCallback = async (modalContext: ModalInteractionContext, createRequest: CreateRequest) => {

    await modalContext.defer(true);

    let numRepeats = null;
    let endRepeatsDate = null;
    try {
        const retVal = BountyUtils.validateNumRepeatsOrEndDate(modalContext.values.endNumOrDate);
        numRepeats = retVal.numRepeats;
        endRepeatsDate = retVal.endRepeatsDate;
    } catch (e) {
        if (e instanceof ValidationError) {
            await modalContext.send({ content: e.message });
            return;
        }
    }

    if (createRequest.isIOU) {
        await finishCreate(createRequest, null, 'IOU for work already done', new Date(), null, numRepeats, endRepeatsDate, modalContext);
    } else {
        const description = modalContext.values.description;
        try {
            BountyUtils.validateDescription(description);
        } catch (e) {
            if (e instanceof ValidationError) {
                await modalContext.send({ content: e.message });
                return;
            }
        }

        const criteria = modalContext.values.criteria;
        try {
            BountyUtils.validateCriteria(criteria);
        } catch (e) {
            if (e instanceof ValidationError) {
                await modalContext.send({ content: e.message });
                return;
            }
        }

        const tags = modalContext.values.tags;
        if (tags) {
            try {
                BountyUtils.validateTag(tags);
            } catch (e) {
                if (e instanceof ValidationError) {
                    await modalContext.send({ content: e.message });
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
                await modalContext.send({ content: 'Please try `UTC` date in format `yyyy-mm-dd`, i.e 2021-08-15' });
                return;
            }
        }

        if (convertedDueDateFromMessage.toString() === 'Invalid Date') {
            await modalContext.send({ content: 'Please try `UTC` date in format `yyyy-mm-dd`, i.e 2021-08-15' });
            return;
        }
        await finishCreate(createRequest, description, criteria, convertedDueDateFromMessage, tags, numRepeats, endRepeatsDate, modalContext);
    }
}

export const finishCreate = async (createRequest: CreateRequest, description: string, criteria: string, dueAt: Date, tags: string, numRepeats?: Number, endRepeatsDate?: Date, modalContext?: ModalInteractionContext) => {

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
        tags,
        numRepeats,
        endRepeatsDate);

    Log.info(`user ${guildMember.user.tag} inserted bounty into db`);

    const cardMessage = await BountyUtils.canonicalCard(newBounty._id, createRequest.activity, await DiscordUtils.getTextChannelfromChannelId(newBounty.createdInChannel), guildMember);

    if (createRequest.isIOU) {
        // await createRequest.commandContext.sendFollowUp({ content: "Your IOU was created." } , { ephemeral: true });
        const IOUContent = `<@${owedTo.id}> An IOU was created for you by <@${guildMember.user.id}>: ${cardMessage.url}`;
        await owedTo.send({ content: IOUContent }).catch(() => { throw new DMPermissionError(IOUContent) });

        const walletNeeded = !(await BountyUtils.userWalletRegistered(owedTo.id));

        if (walletNeeded) {
            // Note: ephemeral messagees are only visible to the user who kicked off the interaction,
            // so we can not send an ephemeral message to the owedTo user to check DMs

            const iouWalletMessage = `Please click the button below to enter your ethereum wallet address (non-ENS) to receive the reward amount for this bounty`;
            const walletButton = new MessageButton().setStyle('SECONDARY').setCustomId('👛').setLabel('Register Wallet');

            await owedTo.send({ content: iouWalletMessage, components: [new MessageActionRow().addComponents(walletButton)] });
        }

        const walletNeededMsg = walletNeeded ? "\n" +
            `${owedTo} has not registered a wallet. Remind them to check their DMs for a register wallet button, or to use the /register-wallet command.` : "";
        if (createRequest.templateId) {
            const msgContent = `An instance of your repeating IOU was created: ${cardMessage.url}` + walletNeededMsg;
            await guildMember.send({ content: msgContent }).catch(() => { throw new DMPermissionError(msgContent) });
        } else {
            const msgContent = "IOU created successfully" + walletNeededMsg;
            await DiscordUtils.activityResponse(createRequest.commandContext, null, msgContent);
        }
    } else if (createRequest.templateId) {
        const msgContent = `<@${guildMember.user.id}> An instance of your repeating bounty was created: ${cardMessage.url}`;
        await guildMember.send({ content: msgContent }).catch(() => { throw new DMPermissionError(msgContent) });

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
    createdInChannel: string,
    tags: string,
    numRepeats?: Number,
    endRepeatsDate?: Date
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
        tags,
        numRepeats,
        endRepeatsDate
    );


    let dbInsertResult = await dbBounty.insertOne(createdBounty);
    if (dbInsertResult == null) {
        Log.error('failed to insert bounty into DB');
        throw new Error('Sorry something is not working, our devs are looking into it.');
    }

    // If this is a new repeating bounty template, create the first occurrence
    if (createdBounty.isRepeatTemplate) {
        const firstBountyOccurrence: Bounty = Object.assign({}, createdBounty);
        firstBountyOccurrence.repeatTemplateId = createdBounty._id;
        delete firstBountyOccurrence._id;
        delete firstBountyOccurrence.isRepeatTemplate;
        dbInsertResult = await dbBounty.insertOne(firstBountyOccurrence);
        if (dbInsertResult == null) {
            Log.error('failed to insert bounty into DB');
            throw new Error('Sorry something is not working, our devs are looking into it.');
        }
        return firstBountyOccurrence;
    } else return createdBounty;

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
    tags: string,
    numRepeats?: Number,
    endRepeatsDate?: Date
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
            keywords: tags ? tags.split(',')
                .map((word) => word.trim().toLowerCase())
                .filter((word) => word) : null,
            channelCategory: bountyCreationChannelCategory.name
        }
    };

    if (createRequest.gate) {
        bountyRecord.gateTo = [{ discordId: gatedTo.id, discordName: gatedTo.name, iconUrl: gatedTo.iconURL() }];
    }

    if (createRequest.evergreen) {
        bountyRecord.evergreen = true;
        bountyRecord.isParent = true;
        if (createRequest.claimLimit !== undefined) {
            bountyRecord.claimLimit = createRequest.claimLimit;
        }
    }

    // Repeating bounty. If templateId set, we are creating an occurrence. If not, we are creating the template itself
    if (createRequest.repeatDays > 0) {
        if (createRequest.templateId) {
            bountyRecord.repeatTemplateId = createRequest.templateId;
        } else {
            bountyRecord.isRepeatTemplate = true;
            bountyRecord.numRepeats = numRepeats;
            bountyRecord.endRepeatsDate = endRepeatsDate ? endRepeatsDate.toISOString() : null;
        }
        bountyRecord.repeatDays = createRequest.repeatDays;

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

