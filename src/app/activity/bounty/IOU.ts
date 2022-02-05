import { Bounty } from '../../types/bounty/Bounty';
import Log from '../../utils/Log';
import { Message, MessageOptions, GuildMember, Guild} from 'discord.js';
import DiscordUtils from '../../utils/DiscordUtils';
import BountyUtils from '../../utils/BountyUtils';
import MongoDbUtils from '../../utils/MongoDbUtils';
import { Db, UpdateWriteOpResult, Double, Int32 } from 'mongodb'
import { IOURequest } from '../../requests/IOURequest';
import { BountyStatus } from '../../constants/bountyStatus';

export const iou = async (IOURequest: IOURequest): Promise<any> => {
    const guildAndMember = await DiscordUtils.getGuildAndMember(IOURequest.guildId, IOURequest.userId);
    const guildMember: GuildMember = guildAndMember.guildMember;
    const guildId: string = guildAndMember.guild.id;
    const owedTo = await DiscordUtils.getGuildMemberFromUserId(IOURequest.owedTo, IOURequest.guildId);

    const newBounty = await createDbHandler(
        IOURequest,
        guildMember,
        owedTo);

    Log.info(`user ${guildMember.user.tag} inserted iou into db`);
    let bountyCard: MessageOptions = {
        embeds: [{
            title: await BountyUtils.createPublicTitle(newBounty),
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
                { name: 'IOU Id', value: newBounty._id.toString(), inline: false },
                { name: 'Reward', value: newBounty.reward.amount + ' ' + newBounty.reward.currency, inline: true },
                { name: 'Status', value: BountyStatus.open, inline: true },
            ],
            timestamp: new Date().getTime(),
            footer: {
                text: '💰 - paid | ❌ - delete ',
            },
        }],
    };

    const message: Message = await guildMember.send(bountyCard);

    await updateMessageStore(newBounty, message);

    await message.react('💰');
    return await message.react('❌');
}

const createDbHandler = async (
    IOURequest: IOURequest,
    guildMember: GuildMember,
    owedTo: GuildMember
): Promise<Bounty> => {
    const db: Db = await MongoDbUtils.connect('bountyboard');
    const dbBounty = db.collection('bounties');

    const IOUBounty: Bounty = generateBountyRecord(
            IOURequest,
            guildMember,
            owedTo);
    

    const dbInsertResult = await dbBounty.insertOne(IOUBounty);
    if (dbInsertResult == null) {
        Log.error('failed to insert iou into DB');
        throw new Error('Sorry something is not working, our devs are looking into it.');
    }

    return IOUBounty;

}

export const generateBountyRecord = (
    IOURequest: IOURequest,
    guildMember: GuildMember,
    owedTo: GuildMember
): Bounty => {

    Log.debug('generating IOU record')
    const [reward, symbol] = (IOURequest.reward != null) ? IOURequest.reward.split(' ') : [null, null];
    let scale = reward.split('.')[1]?.length;
    scale = (scale != null) ? scale : 0;
    const currentDate = (new Date()).toISOString();
    let bountyRecord: Bounty = {
        customerId: IOURequest.guildId,
        title: IOURequest.title,
        owedTo: {
            discordHandle: owedTo.user.tag,
            discordId: owedTo.user.id,
            iconUrl: owedTo.user.avatarURL(),
        },
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
    };

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
        Log.error('failed to update created IOU with message Id');
        throw new Error(`Write to database for IOU ${bounty._id} failed. `);
    }

};
