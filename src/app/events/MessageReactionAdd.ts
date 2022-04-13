import { DMChannel, Message, MessageReaction, PartialUser, TextChannel, User } from 'discord.js';
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

export default class implements DiscordEvent {
    name = 'messageReactionAdd';
    once = false;

    async execute(reaction: MessageReaction, user: User | PartialUser): Promise<any> {
        // When a reaction is received, check if the structure is partial
        if (reaction.partial) {
            Log.info('Pulling full reaction from partial');
            await reaction.fetch();
        }

        if (user.partial) {
            Log.info('Pulling full user from partial');
            try {
                await user.fetch();
            } catch (error) {
                LogUtils.logError('failed to pull user partial', error);
                return;
            }
        }

        if (user.bot) {
            Log.info('Bot detected.');
            return;
        }

        if (reaction.message.author.id !== reaction.client.user.id) {
            Log.info('Message Reaction Processing Stopped. Message author is not this bot');
            return;
        }

        await this.messageReactionHandler(reaction, user as User);
    }

    async messageReactionHandler(reaction: MessageReaction, user: User) {
        let message: Message = await reaction.message.fetch();
        Log.info(`Processing reaction ${reaction.emoji.name} to message ${message.id}`)

        if (message === null) {
            Log.debug('message not found');
            return;
        }

        if (message.embeds == null || message.embeds[0] == null || message.embeds[0].fields[BountyEmbedFields.bountyId] == null) {
            return;
        }

        const bountyId: string = DiscordUtils.getBountyIdFromEmbedMessage(message);
        let request: any;

        if (reaction.emoji.name === '👍') {
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
            });
        } else if (reaction.emoji.name === '🏴') {
            Log.info(`${user.tag} attempting to claim a bounty ${bountyId} from the bounty board`);
            request = new ClaimRequest({
                commandContext: null,
                messageReactionRequest: {
                    user: user,
                    message: message
                },
                clientSyncRequest: null,
            });
        } else if (reaction.emoji.name === '💰') {
            Log.info(`${user.tag} attempting to mark a bounty as paid ${bountyId} from the bounty board`);
            request = new PaidRequest({
                commandContext: null,
                messageReactionRequest: {
                    user: user,
                    message: message
                }
            });
        } else if (reaction.emoji.name === '🙋') {
            Log.info(`${user.tag} attempting to apply for a bounty ${bountyId} from the bounty board`);
            request = new ApplyRequest({
                commandContext: null,
                messageReactionRequest: {
                    user: user,
                    message: message
                },
            });

        } else if (reaction.emoji.name === '❌') {
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
                });
        }

        } else if (reaction.emoji.name === '📮') {
            Log.info(`${user.tag} attempting to submit bounty ${bountyId}`);
            // TODO: have bot ask user for details
            request = new SubmitRequest({
                commandContext: null,
                messageReactionRequest: {
                    user: user,
                    message: message
                },
            });

        } else if (reaction.emoji.name === '✅') {
            Log.info(`${user.tag} attempting to mark bounty ${bountyId} complete`);
            request = new CompleteRequest({
                commandContext: null,
                messageReactionRequest: {
                    user: user,
                    message: message
                },
            });

        } else if (reaction.emoji.name === '👷') {
            Log.info(`${user.tag} attempting to list my claimed bounties`);
            request = new ListRequest({
                commandContext: null,
                listType: 'CLAIMED_BY_ME',
                messageReactionRequest: {
                    user: user,
                    message: message
                },
            });

        } else if (reaction.emoji.name === '📝') {
            Log.info(`${user.tag} attempting to list my created bounties`);
            request = new ListRequest({
                commandContext: null,
                listType: 'CREATED_BY_ME',
                messageReactionRequest: {
                    user: user,
                    message: message
                },
            });

        } else if (reaction.emoji.name === '🔄') {
            Log.info(`${user.tag} attempting to refresh the list`);
            request = new ListRequest({
                commandContext: null,
                listType: undefined,
                messageReactionRequest: {
                    user: user,
                    message: message
                },
            });

        } else if (reaction.emoji.name === '🆘') {
            Log.info(`${user.tag} attempting to seek help for bounty ${bountyId}`);
            request = new HelpRequest({
                commandContext: null,
                messageReactionRequest: {
                    user: user,
                    message: message
                }
            });
        } else {
            return;
        }

        try {
            await handler(request);
        }
        catch (e) {
            if (e instanceof ValidationError) {
                // TO-DO: Consider adding a User (tag, id) metadata field to logging objects
                Log.info(`${user.tag} submitted a request that failed validation`);
                return user.send(`<@${user.id}>\n` + e.message);
            } else if (e instanceof AuthorizationError) {
                Log.info(`${user.tag} submitted a request that failed authorization`);
                return user.send(`<@${user.id}>\n` + e.message);
            }
            else {
                LogUtils.logError('error', e);
                return user.send('Sorry something is not working and our devs are looking into it.');
            }
        }
    }


}