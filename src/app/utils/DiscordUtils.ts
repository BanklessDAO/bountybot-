import { GuildMember, Role, Guild, DMChannel, AwaitMessagesOptions, Message, Collection, Snowflake } from 'discord.js';
import client from '../app';
import { CommandContext } from 'slash-create';
import ValidationError from '../errors/ValidationError';
import { BountyEmbedFields } from '../constants/embeds';
import Log from './Log';
import RuntimeError from '../errors/RuntimeError';

const DiscordUtils = {
    async getGuildMemberFromUserId(userId: string, guildId: string): Promise<GuildMember> {
        const guild = await client.guilds.fetch(guildId);
        return await guild.members.fetch(userId);
    },

    async getRoleFromRoleId(roleId: string, guildId: string): Promise<Role> {
        const guild = await client.guilds.fetch(guildId);
        return await guild.roles.fetch(roleId);
    },

    async getGuildAndMember(guildId: string, userId: string): Promise<{ guild: Guild, guildMember: GuildMember }> {
        const guild = await client.guilds.fetch(guildId);
        return {
            guild: guild,
            guildMember: await guild.members.fetch(userId),
        };
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

		if(message.author.bot) {
			throw new ValidationError(
				'Detected bot response to last message! The previous bounty has been discarded.\n' +
				'Currently, you can only run one Bounty create command at once.\n' +
				'Be sure to check your DMs for any messages from Bountybot.\n' +
				'Please reach out to your favorite Bounty Board representative with any questions.\n',
			);
		}

		return messageText;
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
        return message.embeds[0].fields[BountyEmbedFields.bountyId].value;
    },
}

export default DiscordUtils;