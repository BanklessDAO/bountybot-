import { AwaitMessagesOptions, ButtonInteraction, Collection, DMChannel, Guild, GuildMember, Message, MessageActionRow, MessageButton, Role, Snowflake, TextChannel } from 'discord.js';
import { Db } from 'mongodb';
import { CommandContext } from 'slash-create';
import { listBounty } from '../activity/bounty/List';
import client from '../app';
import { BountyEmbedFields } from '../constants/embeds';
import ConflictingMessageException from '../errors/ConflictingMessageException';
import NotificationPermissionError from '../errors/NotificationPermissionError';
import RuntimeError from '../errors/RuntimeError';
import TimeoutError from '../errors/TimeoutError';
import ValidationError from '../errors/ValidationError';
import { ListRequest } from '../requests/ListRequest';
import { CustomerCollection } from '../types/bounty/CustomerCollection';
import MongoDbUtils from '../utils/MongoDbUtils';
import BountyUtils from './BountyUtils';
import { LogUtils } from './Log';




const DiscordUtils = {
    async getGuildMemberFromUserId(userId: string, guildId: string): Promise<GuildMember> {
        const guild = await client.guilds.fetch(guildId);
        return await guild.members.fetch(userId);
    },

    async getRoleFromRoleId(roleId: string, guildId: string): Promise<Role> {
        const guild = await client.guilds.fetch(guildId);
        return await guild.roles.fetch(roleId);
    },

    async getRolesFromGuildId(guildId: string): Promise<Collection<Snowflake, Role>> {
        const guild = await client.guilds.fetch(guildId);
        return guild.roles.cache;
    },

    async verifyOnlineFromGuildId(guildId: string): Promise<boolean> {
        const guild = await client.guilds.fetch(guildId);
        return guild.available;
    },

    async getGuildNameFromGuildId(guildId: string): Promise<string> {
        const guild = await client.guilds.fetch(guildId);
        return guild.name;
    },

    async getGuildAndMember(guildId: string, userId: string): Promise<{ guild: Guild, guildMember: GuildMember }> {
        const guild = await client.guilds.fetch(guildId);
        return {
            guild: guild,
            guildMember: await guild.members.fetch(userId),
        };
    },

    async getTextChannelfromChannelId(channelId: string): Promise<TextChannel> {
        const channel: TextChannel = await client.channels.fetch(channelId).catch(e => {
            LogUtils.logError(`Could not find channel ${channelId}`, e);
            throw new RuntimeError(e);
        }) as TextChannel;
        return channel;
    },

    async getMessagefromMessageId(messageId: string, channel: TextChannel): Promise<Message> {
        const message = await channel.messages.fetch(messageId).catch(e => {
            LogUtils.logError(`Could not find message ${messageId} in channel ${channel.id} in guild ${channel.guildId}`, e);
            throw new RuntimeError(e);
        }) as Message;
        return message;
    },

    async getBountyChannelfromCustomerId(customerId: string): Promise<TextChannel> {
        const db: Db = await MongoDbUtils.connect('bountyboard');
        const customerCollection = db.collection('customers');

        const dbCustomerResult: CustomerCollection = await customerCollection.findOne({
            customerId: customerId,
        });

        const channel: TextChannel = await client.channels.fetch(dbCustomerResult.bountyChannel).catch(e => {
            LogUtils.logError(`Could not find bounty channel ${dbCustomerResult.bountyChannel} in customer ${customerId}`, e);
            throw new RuntimeError(e);
        }) as TextChannel;
        return channel;
    },

    // TODO: graceful timeout handling needed
    async awaitUserDM(dmChannel: DMChannel, replyOptions: AwaitMessagesOptions): Promise<string> {
        let messages: Collection<Snowflake, Message> = null;
        try {
            messages = await dmChannel.awaitMessages(replyOptions);
            // TODO: this is too broad
        } catch (e) {
            throw new ValidationError(
                'You have timed out!\n' +
                'You can run `/bounty create` to create a new bounty. Please respond to my questions within 5 minutes.\n' +
                'Please reach out to your favorite Bounty Board representative with any questions.\n'
            );
        }
        const message = messages.first();
        const messageText = message.content;

        if (message.author.bot) {
            throw new ValidationError(
                'Detected bot response to last message! The previous bounty has been discarded.\n' +
                'Currently, you can only run one Bounty create command at once.\n' +
                'Be sure to check your DMs for any messages from Bountybot.\n' +
                'Please reach out to your favorite Bounty Board representative with any questions.\n',
            );
        }

        return messageText;
    },

    async awaitUserWalletDM(dmChannel: DMChannel, replyOptions: AwaitMessagesOptions): Promise<string> {
        let messages: Collection<Snowflake, Message> = null;
        try {
            messages = await dmChannel.awaitMessages(replyOptions);
            // TODO: this is too broad
        }
        catch (e) {
            throw new TimeoutError('awaitUserWalletDM');
        }
        const message = messages.first();
        const messageText = message.content;

        if (message.author.bot) {
            throw new ConflictingMessageException(
                'Detected bot response to last message! The previous bounty has been discarded.\n' +
                'Currently, you can only run one Bounty create command at once.\n' +
                'Be sure to check your DMs for any messages from Bountybot.\n' +
                'Please reach out to your favorite Bounty Board representative with any questions.\n',
            );
        }

        return messageText;
    },

    // TODO: graceful timeout handling needed
    async awaitUser(channel: TextChannel, replyOptions: AwaitMessagesOptions): Promise<Message> {
        let messages: Collection<Snowflake, Message> = null;
        try {
            messages = await channel.awaitMessages(replyOptions);
            // TODO: this is too broad
        } catch (e) {
            throw new ValidationError(
                'You have timed out!\n' +
                'You can run `/bounty create` to create a new bounty. Please respond to my questions within 5 minutes.\n' +
                'Please reach out to your favorite Bounty Board representative with any questions.\n'
            );
        }
        return messages.first();
    },

    async interactionResponse(buttonInteraction: ButtonInteraction, content: string) {
        try {
            if (buttonInteraction.deferred || buttonInteraction.replied) await buttonInteraction.editReply({ content: content });
            else await buttonInteraction.reply({ content: content, ephemeral: true });
        } catch (e) {
            if (e.code === 40060) await buttonInteraction.editReply({ content: content });
            else throw new RuntimeError(e);
        }
    },

    // Send a response to a command (use ephemeral) or a reaction (use DM)
    async activityResponse(commandContext: CommandContext, buttonInteraction: ButtonInteraction, content: string): Promise<void> {
        if (!!commandContext) // This was a slash command
            await commandContext.send({ content: content, ephemeral: true });
        else {// This was a button interaction
            await this.interactionResponse(buttonInteraction, content);
        }
    },

    // Send a notification to an interested party (use a DM)
    async activityNotification(content: string, toUser: GuildMember, link: string): Promise<void> {
        try {
            const componentActions = new MessageActionRow().addComponents(
                new MessageButton()
                    .setLabel('View Bounty')
                    .setStyle('LINK')
                    .setURL(link || '')
            );
            await toUser.send({ content, components: link && [componentActions] });
        } catch (e) {
            throw new NotificationPermissionError(content);
        }
    },


    async hasAllowListedRole(userId: string, guildId: string, roles: string[]): Promise<boolean> {
        return await DiscordUtils.hasSomeRole(userId, guildId, roles);
    },

    async hasSomeRole(userId: string, guildId: string, roles: string[]): Promise<boolean> {
        for (const role of roles) {
            if (await DiscordUtils.hasRole(userId, guildId, role)) {
                return true;
            }
        }
        return false;
    },

    async hasRole(userId: string, guildId: string, role: string): Promise<boolean> {
        const guildMember = await DiscordUtils.getGuildMemberFromUserId(userId, guildId);
        return guildMember.roles.cache.some(r => r.id === role);
    },

    getBountyIdFromEmbedMessage(message: Message): string {
        if (message.embeds[0].fields[BountyEmbedFields.bountyId].name !== 'Bounty Id') return null;
        return message.embeds[0].fields[BountyEmbedFields.bountyId].value;
    },

    async refreshLastList(customerId, request) {
        const discordRegex = /https:\/\/discord.com\/channels\/(.*)\/(.*)\/(.*)/;
        const backToListLink = await BountyUtils.getLatestCustomerList(customerId);

        if (!backToListLink) return;

        const [_, guildId, channelId, messageId] = backToListLink.match(discordRegex);

        if (!guildId || !channelId || !messageId) return;

        try {
            const guild = await client.guilds.cache.get(guildId);
            const channel = await guild.channels.cache.get(channelId) as TextChannel;
            const message = await channel.messages.fetch(messageId);
            await listBounty(new ListRequest({
                commandContext: request.commandContext,
                listType: undefined,
                messageReactionRequest: {
                    user: request.buttonInteraction.user,
                    message: message
                },
                buttonInteraction: request.buttonInteraction,
            }), true);
        } catch (e) {
            console.log("Could not refresh the bounty list", backToListLink, e);
        }

        return;
    }
}

export default DiscordUtils;