import {
    CommandContext,
    CommandOptionType,
    SlashCommand,
    SlashCreator,
} from 'slash-create';
import { handler } from '../../activity/bounty/Handler';

import ValidationError from '../../errors/ValidationError';
import Log, { LogUtils } from '../../utils/Log';
import { Request } from '../../requests/Request';
import { Activities } from '../../constants/activities';
import { CreateRequest } from '../../requests/CreateRequest';
import { PaidRequest } from '../../requests/PaidRequest';
import { DeleteRequest } from '../../requests/DeleteRequest';
import { ListRequest } from '../../requests/ListRequest';
import { HelpRequest } from '../../requests/HelpRequest';
import AuthorizationError from '../../errors/AuthorizationError';
import DiscordUtils from '../../utils/DiscordUtils';
import { guildIds } from '../../constants/customerIds';


export default class IOU extends SlashCommand {
    constructor(creator: SlashCreator) {
        super(creator, {
            name: 'iou',
            description: 'List, Create, Delete, and mark IOUs paid',
            //TODO: make this dynamic? - can pull guildId list by querying mongo from app.ts on startup
            guildIDs: guildIds,
            options: [
                {
                    name: Activities.create,
                    type: CommandOptionType.SUB_COMMAND,
                    description: 'Create a new IOU',
                    options: [
                        {
                            name: 'owed-to',
                            type: CommandOptionType.USER,
                            description: 'Select a user owed this IOU',
                            required: true,
                        },
                        {
                            name: 'reward',
                            type: CommandOptionType.STRING,
                            description: 'What is the reward? (i.e 100 BANK)',
                            required: true,
                        },
                        {
                            name: 'why',
                            type: CommandOptionType.STRING,
                            description: 'What is the reward for?',
                            required: true,
                        }
                    ],
                },
                {
                    name: Activities.paid,
                    type: CommandOptionType.SUB_COMMAND,
                    description: 'Mark an IOU as paid',
                    options: [
                        {
                            name: 'iou-id',
                            type: CommandOptionType.STRING,
                            description: 'IOU ID',
                            required: true,
                        },
                        {
                            name: 'notes',
                            type: CommandOptionType.STRING,
                            description: 'Optional notes',
                            required: false,
                        },
                    ],
                },
                {
                    name: Activities.list,
                    type: CommandOptionType.SUB_COMMAND,
                    description: 'View list of IOUs you created',
                    options: [
                        {
                            name: 'list-type',
                            type: CommandOptionType.STRING,
                            description: 'Which IOUs should be displayed?',
                            choices: [
                                {
                                    name: 'paid-by-me',
                                    value: 'PAID_BY_ME',
                                },
                                {
                                    name: 'unpaid-by-me',
                                    value: 'UNPAID_BY_ME',
                                },
                            ],
                            required: true,
                        },
                    ],
                },
                {
                    name: Activities.delete,
                    type: CommandOptionType.SUB_COMMAND,
                    description: 'Delete an unpaid IOU',
                    options: [
                        {
                            name: 'iou-id',
                            type: CommandOptionType.STRING,
                            description: 'IOU ID',
                            required: true,
                        },
                        {
                            name: 'notes',
                            type: CommandOptionType.STRING,
                            description: 'Optional notes',
                            required: false,
                        },
                    ],
                },
                {
                    name: Activities.help,
                    type: CommandOptionType.SUB_COMMAND,
                    description: 'FAQ for using IOU commands',
                },
            ],
            throttling: {
                usages: 2,
                duration: 1,
            },
            defaultPermission: true,
        });
    }

    /**
     * Transform slash command to activity request and route through the correct handlers.
     * Responsible for graceful error handling and status messages.
     * Wrap all received error messages with a user mention.
     * 
     * @param commandContext 
     * @returns empty promise for async calls
     */
    async run(commandContext: CommandContext): Promise<void> {
        // TODO: migrate to adding handlers to array
        // core-logic of any Activity:
        // request initiator (slash command, message reaction, dm reaction callback)
        // Auth check
        // validate/sanitize user input
        // Parse user input into database/api call
        // Successful db/API response --> user success handling + embed update, allow request initiator to delete original /bounty message
        // Error db/API response --> throw error, allow request initiator to handle logging, and graceful error message to users
        Log.debug(`Slash command triggered for ${commandContext.subcommands[0]}`);
        let request: any;
        switch (commandContext.subcommands[0]) {
            case Activities.create:
                request = new CreateRequest({
                    commandContext: commandContext 
                });
                break;
            case Activities.paid:
                request = new PaidRequest({
                    commandContext: commandContext,
                    messageReactionRequest: null
                });
                break;
            case Activities.list:
                request = new ListRequest({
                    commandContext: commandContext
                });
                break;
            case Activities.delete:
                request = new DeleteRequest({
                    commandContext: commandContext,
                    messageReactionRequest: null,
                    directRequest: null
                });
                break;
            case Activities.help:
                request = new HelpRequest({
                    commandContext: commandContext,
                    messageReactionRequest: null
                });
                break;
            default:
                await commandContext.send({content: 'Command not recognized.'});
                break;
        }
        const { guildMember } = await DiscordUtils.getGuildAndMember((request as Request).guildId, (request as Request).userId);

        try {
            await handler(request)
        }
        catch (e) {
            if (e instanceof ValidationError) {
                await guildMember.send(`<@${commandContext.user.id}>\n` + e.message);
                await commandContext.delete();
                return;
            } else if (e instanceof AuthorizationError) {
                await guildMember.send(`<@${commandContext.user.id}>\n` + e.message);
                commandContext.delete();
                return;
            }
            else {
                LogUtils.logError('error', e);
                await guildMember.send('Sorry something is not working and our devs are looking into it.');
                await commandContext.delete();
                return;
            }
        }

        return await commandContext.delete();

    }
}