import { HelpRequest } from '../../requests/HelpRequest';
import DiscordUtils from '../../utils/DiscordUtils';
import client from '../../app';
import Log from '../../utils/Log';
import { GuildMember, TextChannel } from 'discord.js';
import MongoDbUtils from '../../utils/MongoDbUtils';
import mongo, { Db } from 'mongodb';
import { BountyCollection } from '../../types/bounty/BountyCollection';
import { CustomerCollection } from '../../types/bounty/CustomerCollection';


export const helpBounty = async (request: HelpRequest): Promise<void> => {
    Log.debug('In Help activity');
    if (request.bountyId) {

        const getDbResult: {dbBountyResult: BountyCollection, bountyChannel: string} = await getDbHandler(request);
        // Since we are in DMs with new flow, guild might not be populated in the request
        if (request.guildId === undefined || request.guildId === null) {
            request.guildId = getDbResult.dbBountyResult.customerId;
        }
        
        const helpRequestedUser = await DiscordUtils.getGuildMemberFromUserId(request.userId, request.guildId);
        Log.info(`${request.bountyId} bounty requested help by ${helpRequestedUser.user.tag}`);

        const bountyCreator: GuildMember = await DiscordUtils.getGuildMemberFromUserId(getDbResult.dbBountyResult.createdBy.discordId, request.guildId)
        
        const bountyUrl = process.env.BOUNTY_BOARD_URL + request.bountyId;
        const creatorHelpDM = 
            `<@${helpRequestedUser.id}> has requested help with the following bounty:\n` +
            `<${bountyUrl}>\n` + 
            `Don't hesitate to reach out to your favorite Bounty Board representative with any questions!`;

        const userHelpDM = 
            `<@${bountyCreator.id}> has been notified of your request for help with the following bounty:\n` +
            `<${bountyUrl}>`;
        
        await bountyCreator.send({ content: creatorHelpDM});
        await helpRequestedUser.send({ content: userHelpDM });
    } else {
        const bountyChannel: TextChannel = await client.channels.fetch(request.commandContext.channelID) as TextChannel;
    
        await bountyChannel.send({ content: `Type **/bounty** and you will see a list of commands and their descriptions. ` +
         `Use <tab> to step through the options for each command.\nFor more detailed help, go here: ${process.env.BOUNTY_BOARD_HELP_URL}`});
    }

    return;
}

/**
 * Wraps read only calls to the database.
 * Intended to be replaced with calls to the API.
 * Note that the full customer read result is left out to be forward compatible with
 *     publishing bounties to a specified discord channel or multiple discord channels.
 *     This is b/c bountyChannel will be consumed from the bounty record at every step except publish
 * @param request HelpRequest, passed from activity initiator
 * @returns 
 */
const getDbHandler = async (request: HelpRequest): Promise<{dbBountyResult: BountyCollection, bountyChannel: string}> => {
    const db: Db = await MongoDbUtils.connect('bountyboard');
	const bountyCollection = db.collection('bounties');
    const customerCollection = db.collection('customers');

	const dbBountyResult: BountyCollection = await bountyCollection.findOne({
		_id: new mongo.ObjectId(request.bountyId),
	});

    const dbCustomerResult: CustomerCollection = await customerCollection.findOne({
        customerId: request.guildId,
    });

    return {
        dbBountyResult: dbBountyResult,
        bountyChannel: dbCustomerResult.bountyChannel
    }
}