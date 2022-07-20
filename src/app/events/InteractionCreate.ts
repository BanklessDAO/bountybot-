import { ButtonInteraction, DMChannel, Message, MessageReaction, PartialUser, TextChannel, User } from 'discord.js';
import Log, { LogUtils } from '../utils/Log';
import ValidationError from '../errors/ValidationError';
import DiscordUtils from '../utils/DiscordUtils';
import { DiscordEvent } from '../types/discord/DiscordEvent';
import { DeleteRequest } from '../requests/DeleteRequest';
import { SubmitRequest } from '../requests/SubmitRequest';
import { CompleteRequest } from '../requests/CompleteRequest';
import { HelpRequest } from '../requests/HelpRequest';
import { ClaimRequest } from '../requests/ClaimRequest';
import { handler } from '../activity/bounty/Handler';
import AuthorizationError from '../errors/AuthorizationError';
import { BountyEmbedFields } from '../constants/embeds';
import { PublishRequest } from '../requests/PublishRequest';
import { PaidRequest } from '../requests/PaidRequest';
import { ApplyRequest } from '../requests/ApplyRequest';
import { ListRequest } from '../requests/ListRequest';
import { Activities } from '../constants/activities';
import NotificationPermissionError from '../errors/NotificationPermissionError';
import DMPermissionError from '../errors/DMPermissionError';
import ErrorUtils from '../utils/ErrorUtils';

export default class implements DiscordEvent {
    name = 'interactionCreate';
    once = false;

    async execute(interaction: ButtonInteraction): Promise<any> {
        const user: User = interaction.user;
        if (!interaction.isButton()) return;
        if (user.bot) {
            // Log.info('Bot detected.');
            return;
        }

        if (interaction.message.author.id !== interaction.client.user.id) {
            // Log.info('Message Reaction Processing Stopped. Message author is not this bot');
            return;
        }

        await this.interactionHandler(interaction, user);
    }

    async interactionHandler(interaction: ButtonInteraction, user: User) {
        let message: Message = interaction.message as Message<boolean>;
        Log.info(`Processing reaction ${interaction.customId} to message ${message.id}`)

        if (message === null) {
            Log.debug('message not found');
            return;
        }

        if (message.embeds == null || message.embeds[0] == null || message.embeds[0].fields[BountyEmbedFields.bountyId] == null) {
            return;
        }

        const bountyId: string = DiscordUtils.getBountyIdFromEmbedMessage(message);
        let request: any;

        if (interaction.customId === '👍') {
            Log.info(`${user.tag} attempting to publish bounty ${bountyId}`);
            const guildId = message.embeds[0].author.name.split(': ')[1];

            request = new PublishRequest({
                commandContext: null,
                messageReactionRequest: null,
                directRequest: {
                    bountyId: bountyId,
                    guildId: guildId,
                    userId: user.id,
                    activity: Activities.publish,
                    bot: user.bot
                },
                clientSyncRequest: null,
                buttonInteraction: interaction,
            });
        } else if (interaction.customId === '🏴') {
            Log.info(`${user.tag} attempting to claim a bounty ${bountyId} from the bounty board`);
            request = new ClaimRequest({
                commandContext: null,
                messageReactionRequest: {
                    user: user,
                    message: message
                },
                clientSyncRequest: null,
                buttonInteraction: interaction,
            });
        } else if (interaction.customId === '💰') {
            Log.info(`${user.tag} attempting to mark a bounty as paid ${bountyId} from the bounty board`);
            request = new PaidRequest({
                commandContext: null,
                messageReactionRequest: {
                    user: user,
                    message: message
                },
                buttonInteraction: interaction,
            });
        } else if (interaction.customId === '🙋') {
            Log.info(`${user.tag} attempting to apply for a bounty ${bountyId} from the bounty board`);
            request = new ApplyRequest({
                commandContext: null,
                messageReactionRequest: {
                    user: user,
                    message: message
                },
                buttonInteraction: interaction,
            });

        } else if (interaction.customId === '❌') {
            Log.info(`${user.tag} attempting to delete bounty ${bountyId}`);
            const guildId = message.embeds[0].author.name.split(': ')[1];

            if (message.channel instanceof DMChannel) {
                request = new DeleteRequest({
                    commandContext: null,
                    messageReactionRequest: null,
                    directRequest: {
                        bountyId: bountyId,
                        guildId: guildId,
                        userId: user.id,
                        resolutionNote: null,
                        activity: Activities.delete,
                        bot: user.bot
                    },
                    buttonInteraction: interaction,
                })
            }
            else if (message.channel instanceof TextChannel) {
                request = new DeleteRequest({
                    commandContext: null,
                    messageReactionRequest: {
                        user: user,
                        message: message
                    },
                    directRequest: null,
                    buttonInteraction: interaction,
                });
            }

        } else if (interaction.customId === '📮') {
            Log.info(`${user.tag} attempting to submit bounty ${bountyId}`);
            // TODO: have bot ask user for details
            request = new SubmitRequest({
                commandContext: null,
                messageReactionRequest: {
                    user: user,
                    message: message
                },
                buttonInteraction: interaction
            });

        } else if (interaction.customId === '✅') {
            Log.info(`${user.tag} attempting to mark bounty ${bountyId} complete`);
            request = new CompleteRequest({
                commandContext: null,
                messageReactionRequest: {
                    user: user,
                    message: message
                },
                buttonInteraction: interaction,
            });

        } else if (interaction.customId === '👷') {
            Log.info(`${user.tag} attempting to list my claimed bounties`);
            request = new ListRequest({
                commandContext: null,
                listType: 'CLAIMED_BY_ME',
                messageReactionRequest: {
                    user: user,
                    message: message
                },
                buttonInteraction: interaction,
            });

        } else if (interaction.customId === '📝') {
            Log.info(`${user.tag} attempting to list my created bounties`);
            request = new ListRequest({
                commandContext: null,
                listType: 'CREATED_BY_ME',
                messageReactionRequest: {
                    user: user,
                    message: message
                },
                buttonInteraction: interaction,
            });

        } else if (interaction.customId === '🔄') {
            Log.info(`${user.tag} attempting to refresh the list`);
            request = new ListRequest({
                commandContext: null,
                listType: undefined,
                messageReactionRequest: {
                    user: user,
                    message: message
                },
                buttonInteraction: interaction,
            });

        } else if (interaction.customId === '🆘') {
            Log.info(`${user.tag} attempting to seek help for bounty ${bountyId}`);
            request = new HelpRequest({
                commandContext: null,
                messageReactionRequest: {
                    user: user,
                    message: message
                },
                buttonInteraction: interaction,
            });
        } else {
            return;
        }

        try {
            await handler(request);
        }
        catch (e) {
            let errorContent = e.message;
            if (e instanceof NotificationPermissionError) {
                return ErrorUtils.sendToDefaultChannel(e.message, request);
            } else if (e instanceof ValidationError) {
                // TO-DO: Consider adding a User (tag, id) metadata field to logging objects
                Log.info(`${user.tag} submitted a request that failed validation`);
            } else if (e instanceof AuthorizationError) {
                Log.info(`${user.tag} submitted a request that failed authorization`);
            
            } else if (e instanceof DMPermissionError) {
                Log.info(`${user.tag} submitted a request that failed DM`);
                errorContent = `It looks like bot does not have permission to DM <@${user.id}>.\n \n` +
                    '**Message** \n' +
                    e.message;
            } else {
                LogUtils.logError('error', e);
                errorContent = 'Sorry something is not working and our devs are looking into it.';
            }

            return await DiscordUtils.interactionResponse(interaction, errorContent);
        }
    }
}