import { Bounty } from '../../types/bounty/Bounty';
import Log, { LogUtils } from '../../utils/Log';
import { Role, Message, MessageOptions, GuildMember, DMChannel, AwaitMessagesOptions, MessageReaction, User } from 'discord.js';
import DiscordUtils from '../../utils/DiscordUtils';
import BountyUtils from '../../utils/BountyUtils';
import MongoDbUtils from '../../utils/MongoDbUtils';
import { Db, UpdateWriteOpResult, Double, Int32 } from 'mongodb'
import ValidationError from '../../errors/ValidationError';
import { CreateRequest } from '../../requests/CreateRequest';
import { publishBounty } from './Publish';
import { deleteBounty } from './Delete';
import { PublishRequest } from '../../requests/PublishRequest';
import { DeleteRequest } from '../../requests/DeleteRequest';
import { Activities } from '../../constants/activities';
import { BountyStatus } from '../../constants/bountyStatus';
import { BountyCollection } from '../../types/bounty/BountyCollection';

export const createBounty = async (createRequest: CreateRequest): Promise<any> => {
    const guildAndMember = await DiscordUtils.getGuildAndMember(createRequest.guildId, createRequest.userId);
    const guildMember: GuildMember = guildAndMember.guildMember;
    const guildId: string = guildAndMember.guild.id;

    const createInfoMessage = `Hello <@${guildMember.id}>!\n` +
        `Please respond to the following questions within 5 minutes.\n` +
        `Can you tell me a description of your bounty?`;
    const workNeededMessage: Message = await guildMember.send({ content: createInfoMessage });
    const dmChannel: DMChannel = await workNeededMessage.channel.fetch() as DMChannel;
    const replyOptions: AwaitMessagesOptions = {
        max: 1,
        // time is in ms
        time: 300000,
        errors: ['time'],
    };

    const description = await DiscordUtils.awaitUserDM(dmChannel, replyOptions);
    try {
        BountyUtils.validateDescription(description);
    } catch (e) {
        if (e instanceof ValidationError) {
            guildMember.send({ content: `<@${guildMember.user.id}>\n` + e.message })
        }
    }

    await guildMember.send({ content: 'Awesome! Now what is absolutely required for the bounty to be complete?' });

    const criteria = await DiscordUtils.awaitUserDM(dmChannel, replyOptions);
    try {
        BountyUtils.validateCriteria(criteria);
    } catch (e) {
        if (e instanceof ValidationError) {
            guildMember.send({ content: `<@${guildMember.user.id}>\n` + e.message })
        }
    }

    let convertedDueDateFromMessage: Date;
    do {
        // TODO: update default date to a reaction instead of text input
        // TODO: update hardcoded no/skip to a REGEX
        const dueDateMessage = 
            'When is the work for this bounty due by?\n' + 
            'Please enter `UTC` date in format `yyyy-mm-dd`, i.e 2022-01-01`? (type \'no\' or \'skip\' for a default value of 3 months from today)';
        await guildMember.send({ content:  dueDateMessage});
        const dueAtMessageText = await DiscordUtils.awaitUserDM(dmChannel, replyOptions);

        if (! (dueAtMessageText.toLowerCase() === 'no' || dueAtMessageText.toLowerCase() === 'skip') ) {
            try {
                convertedDueDateFromMessage = BountyUtils.validateDate(dueAtMessageText);
            } catch (e) {
                Log.warn('user entered invalid date for bounty');
                await guildMember.send({ content: 'Please try `UTC` date in format `yyyy-mm-dd`, i.e 2021-08-15' });
            }
        } else if (dueAtMessageText.toLowerCase() === 'no' || dueAtMessageText.toLowerCase() === 'skip') {
            convertedDueDateFromMessage = null;
            break;
        }

        if (convertedDueDateFromMessage.toString() === 'Invalid Date') {
            Log.warn('user entered invalid date for bounty');
            await guildMember.send({ content: 'Please try `UTC` date in format `yyyy-mm-dd`, i.e 2021-08-15' });
        }
    } while (convertedDueDateFromMessage.toString() === 'Invalid Date');
    const dueAt = convertedDueDateFromMessage ? convertedDueDateFromMessage : BountyUtils.threeMonthsFromNow();

    const newBounty = await createDbHandler(
        createRequest,
        description,
        criteria,
        dueAt,
        guildMember);


    Log.info(`user ${guildMember.user.tag} inserted bounty into db`);
    let bountyPreview: MessageOptions = {
        embeds: [{
            title: BountyUtils.createPublicTitle(newBounty),
            url: (process.env.BOUNTY_BOARD_URL + newBounty._id),
            author: {
                icon_url: guildMember.user.avatarURL(),
                name: `${newBounty.createdBy.discordHandle}: ${guildId}`,
            },
            description: newBounty.description,
            fields: [
                // TODO: figure out a way to explicitly match order with BountyEmbedFields
                // static bountyId = 0;
                // static criteria = 1;
                // static reward = 2;
                // static status = 3;
                // static deadline = 4;
                // static createdBy = 5;
                { name: 'Bounty Id', value: newBounty._id.toString(), inline: false },
                { name: 'Criteria', value: newBounty.criteria.toString() },
                { name: 'Reward', value: newBounty.reward.amount + ' ' + newBounty.reward.currency, inline: true },
                { name: 'Status', value: BountyStatus.open, inline: true },
                { name: 'Deadline', value: BountyUtils.formatDisplayDate(newBounty.dueAt), inline: true },
                { name: 'Created by', value: newBounty.createdBy.discordHandle.toString(), inline: true },
            ],
            timestamp: new Date().getTime(),
            footer: {
                text: '👍 - publish | ❌ - delete | Please reply within 60 minutes',
            },
        }],
    };

    if (newBounty.gate) {
        const role: Role = await DiscordUtils.getRoleFromRoleId(newBounty.gate[0], guildId);
        bountyPreview.embeds[0].fields.push({ name: 'Gated to', value: role.name, inline: false });
    }

    if (newBounty.assign) {
        const assignedUser: GuildMember = await DiscordUtils.getGuildMemberFromUserId(newBounty.assign, guildId);
        bountyPreview.embeds[0].fields.push({ name: 'Assigned to', value: assignedUser.user.tag, inline: false });
    }

    const publishOrDeleteMessage = 
        'Thank you! If it looks good, please hit 👍 to publish the bounty.\n' +
        'Once the bounty has been published, others can view and claim the bounty.\n' +
        'If you are not happy with the bounty, hit ❌ to delete it and start over.\n'
    await guildMember.send(publishOrDeleteMessage);
    const message: Message = await guildMember.send(bountyPreview);

    await updateMessageStore(newBounty, message);

    await message.react('👍');
    return await message.react('❌');
}

const createDbHandler = async (
    createRequest: CreateRequest,
    description: string,
    criteria: string,
    dueAt: Date,
    guildMember: GuildMember
): Promise<Bounty> => {
    const db: Db = await MongoDbUtils.connect('bountyboard');
    const dbBounty = db.collection('bounties');

    const createdBounty: Bounty = generateBountyRecord(
            createRequest,
            description,
            criteria,
            dueAt,
            guildMember);
    

    const dbInsertResult = await dbBounty.insertOne(createdBounty);
    if (dbInsertResult == null) {
        Log.error('failed to insert bounty into DB');
        throw new Error('Sorry something is not working, our devs are looking into it.');
    }

    return createdBounty;

}

export const generateBountyRecord = (
    createRequest: CreateRequest,
    description: string,
    criteria: string,
    dueAt: Date,
    guildMember: GuildMember
): Bounty => {

    Log.debug('generating bounty record')
    const [reward, symbol] = (createRequest.reward != null) ? createRequest.reward.split(' ') : [null, null];
    let scale = reward.split('.')[1]?.length;
    scale = (scale != null) ? scale : 0;
    const currentDate = (new Date()).toISOString();
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
        statusHistory: [
            {
                status: BountyStatus.draft,
                setAt: currentDate,
            },
        ],
        status: BountyStatus.draft,
        dueAt: dueAt.toISOString(),
    };

    if (createRequest.gate) {
        bountyRecord.gate = [createRequest.gate]
    }

    if (createRequest.evergreen) {
        bountyRecord.evergreen = true;
        bountyRecord.isParent = true;
        if (createRequest.claimLimit !== undefined) {
            bountyRecord.claimLimit = createRequest.claimLimit;
        }

    if (createRequest.assign) {
        bountyRecord.assign = createRequest.assign;
        bountyRecord.assignedName = createRequest.assignedName;
    }

    return bountyRecord;
};

// Save where we sent the Bounty message embeds for future updates
export const updateMessageStore = async (bounty: Bounty, message: Message): Promise<any> => {
    const db: Db = await MongoDbUtils.connect('bountyboard');
    const bountyCollection = db.collection('bounties');
    const writeResult: UpdateWriteOpResult = await bountyCollection.updateOne(bounty, {
        $set: {
            creatorMessage: {
                messageId: message.id,
                channelId: message.channel.id,
            },
        },
    });

    if (writeResult.result.ok !== 1) {
        Log.error('failed to update created bounty with message Id');
        throw new Error(`Write to database for bounty ${bounty._id} failed. `);
    }

};
