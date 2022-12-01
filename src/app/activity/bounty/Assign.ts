import { GuildMember, Message, MessageButton, MessageEmbedOptions } from 'discord.js';
import { AssignRequest } from '../../requests/AssignRequest';
import { BountyCollection } from '../../types/bounty/BountyCollection';
import DiscordUtils from '../../utils/DiscordUtils';
import Log from '../../utils/Log';
import mongo, { Db, UpdateWriteOpResult } from 'mongodb';
import MongoDbUtils from '../../utils/MongoDbUtils';
import { CustomerCollection } from '../../types/bounty/CustomerCollection';
import BountyUtils from '../../utils/BountyUtils';

export const assignBounty = async (request: AssignRequest): Promise<any> => {
    Log.debug('In Assign activity');

    const assigningUser = await DiscordUtils.getGuildMemberFromUserId(request.userId, request.guildId);
    Log.info(`${request.bountyId} bounty being assigned by ${assigningUser.user.tag}`);
    
    let getDbResult: {dbBountyResult: BountyCollection, bountyChannel: string} = await getDbHandler(request);

    const assignedUser: GuildMember = await assigningUser.guild.members.fetch(request.assign);
    await writeDbHandler(request, getDbResult.dbBountyResult, assignedUser);
    
    const cardMessage = await BountyUtils.canonicalCard(getDbResult.dbBountyResult._id, request.activity);

    let assigningContent = `Your bounty has been assigned to <@${assignedUser.user.id}>`;
    let assignedContent = `You have been assigned this bounty! Click Claim It to claim. Reach out to <@${assigningUser.id}> with any questions.\n`;
    let assigneeBountyEmbed = await assigneeBountySummaryEmbed(cardMessage, request.guildId);
    
    await DiscordUtils.activityNotification(assignedContent, assignedUser, cardMessage.url, assigneeBountyEmbed);
    await DiscordUtils.activityResponse(request.commandContext, request.buttonInteraction, assigningContent, cardMessage.url);
    return;
};

const getDbHandler = async (request: AssignRequest): Promise<{dbBountyResult: BountyCollection, bountyChannel: string}> => {
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

const writeDbHandler = async (request: AssignRequest, assignedBounty: BountyCollection, assignedUser: GuildMember): Promise<BountyCollection> => {
    const db: Db = await MongoDbUtils.connect('bountyboard');
    const bountyCollection = db.collection('bounties');
    
    const writeResult: UpdateWriteOpResult = await bountyCollection.updateOne(assignedBounty, {
        $set: {
            assignTo: {
                discordId: request.assign,
                discordHandle: assignedUser.user.tag,
                iconUrl: assignedUser.user.avatarURL(),
            },
        },
    });

    if (writeResult.result.ok !== 1) {
        Log.error('failed to update assigned bounty');
        throw new Error(`Write to database for bounty ${request.bountyId} failed for ${request.activity} `);
    }

    return assignedBounty;
}

const assigneeBountySummaryEmbed = async (message: Message, guildId: string): Promise<any> => {
    const embedOrigMessage = message.embeds[0];
    
    const cardEmbeds: MessageEmbedOptions = {
        title: embedOrigMessage.title,
        url: embedOrigMessage.url,
        author: {
            iconURL: embedOrigMessage.author.iconURL || embedOrigMessage.author.url,
            name: `${embedOrigMessage.author.name}: ${guildId}`
        },
        description: embedOrigMessage.description,
        fields: embedOrigMessage.fields.filter(({ name }) => name == 'Bounty Id' || name == "Reward"),
    };

    const claimButton = new MessageButton().setStyle('SECONDARY').setCustomId('🏴').setLabel('Claim It');
    
    return { embeds: cardEmbeds, buttons: [claimButton] };
}

