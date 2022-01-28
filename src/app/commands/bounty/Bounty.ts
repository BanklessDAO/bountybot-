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
import { PublishRequest } from '../../requests/PublishRequest';
import { ClaimRequest } from '../../requests/ClaimRequest';
import { ApplyRequest } from '../../requests/ApplyRequest';
import { AssignRequest } from '../../requests/AssignRequest';
import { SubmitRequest } from '../../requests/SubmitRequest';
import { CompleteRequest } from '../../requests/CompleteRequest';
import { DeleteRequest } from '../../requests/DeleteRequest';
import { ListRequest } from '../../requests/ListRequest';
import { HelpRequest } from '../../requests/HelpRequest';
import { GmRequest } from '../../requests/GmRequest';
import AuthorizationError from '../../errors/AuthorizationError';
import DiscordUtils from '../../utils/DiscordUtils';
import { guildIds } from '../../constants/customerIds';


export default class Bounty extends SlashCommand {
    constructor(creator: SlashCreator) {
        super(creator, {
            name: 'bounty',
            description: 'List, create, apply, assign, claim, delete, and mark bounties complete',
            //TODO: make this dynamic? - can pull guildId list by querying mongo from app.ts on startup
            guildIDs: guildIds,
            options: [
                {
                    name: Activities.create,
                    type: CommandOptionType.SUB_COMMAND,
                    description: 'Create a new bounty',
                    options: [
                        {
                            name: 'title',
                            type: CommandOptionType.STRING,
                            description: 'What should the bounty be called?',
                            required: true,
                        },
                        {
                            name: 'reward',
                            type: CommandOptionType.STRING,
                            description: 'What is the reward? (i.e 100 BANK)',
                            required: true,
                        },
                        {
                            name: 'evergreen',
                            type: CommandOptionType.BOOLEAN,
                            description: 'Make this bounty repeatedly claimable (true/false)',
                            required: false,
                        },
                        {
                            name: 'claim-limit',
                            type: CommandOptionType.INTEGER,
                            description: 'Maximum number of claimants for an evergreen bounty (2 to 100)',
                            required: false,
                        },
                        {
                            name: 'gate',
                            type: CommandOptionType.ROLE,
                            description: 'Select a role that will have permissions to claim this bounty',
                            required: false,
                        },
                        {
                            name: 'assign-to',
                            type: CommandOptionType.USER,
                            description: 'Select a user that will have permissions to claim this bounty',
                            required: false,
                        },
                        {
                            name: 'require-application',
                            type: CommandOptionType.BOOLEAN,
                            description: 'Require users to apply before claiming',
                            required: false,
                        }
                    ],
                },
                {
                    name: Activities.publish,
                    type: CommandOptionType.SUB_COMMAND,
                    description: 'Publish your bounty for other users to claim.',
                    options: [
                        {
                            name: 'bounty-id',
                            type: CommandOptionType.STRING,
                            description: 'Bounty ID',
                            required: true,
                        },
                    ],
                },
                {
                    name: Activities.claim,
                    type: CommandOptionType.SUB_COMMAND,
                    description: 'Claim a bounty to work on',
                    options: [
                        {
                            name: 'bounty-id',
                            type: CommandOptionType.STRING,
                            description: 'Bounty ID',
                            required: true,
                        },
                    ],
                },
                {
                    name: Activities.submit,
                    type: CommandOptionType.SUB_COMMAND,
                    description: 'Submit the bounty that you are working on. Bounty will be reviewed',
                    options: [
                        {
                            name: 'bounty-id',
                            type: CommandOptionType.STRING,
                            description: 'Bounty ID',
                            required: true,
                        },
                        {
                            name: 'url',
                            type: CommandOptionType.STRING,
                            description: 'Url of work',
                            required: false,
                        },
                        {
                            name: 'notes',
                            type: CommandOptionType.STRING,
                            description: 'any additional notes for bounty completion',
                            required: false,
                        },
                    ],
                },
                {
                    name: Activities.complete,
                    type: CommandOptionType.SUB_COMMAND,
                    description: 'Mark bounty as complete and reward the claimer',
                    options: [
                        {
                            name: 'bounty-id',
                            type: CommandOptionType.STRING,
                            description: 'Bounty ID',
                            required: true,
                        },
                    ],
                },
                {
                    name: Activities.assign,
                    type: CommandOptionType.SUB_COMMAND,
                    description: 'Assign a bounty as claimable by a user',
                    options: [
                        {
                            name: 'bounty-id',
                            type: CommandOptionType.STRING,
                            description: 'Bounty ID',
                            required: true,
                        },
                        {
                            name: 'assign-to',
                            type: CommandOptionType.USER,
                            description: 'Assigned User',
                            required: true,
                        },
                    ],
                },
                {
                    name: Activities.apply,
                    type: CommandOptionType.SUB_COMMAND,
                    description: 'Apply for a bounty',
                    options: [
                        {
                            name: 'bounty-id',
                            type: CommandOptionType.STRING,
                            description: 'Bounty ID',
                            required: true,
                        },
                    ],
                },
                {
                    name: Activities.list,
                    type: CommandOptionType.SUB_COMMAND,
                    description: 'View list of bounties you created or are claimed',
                    options: [
                        {
                            name: 'list-type',
                            type: CommandOptionType.STRING,
                            description: 'Which bounties should be displayed?',
                            choices: [
                                {
                                    name: 'created by me',
                                    value: 'CREATED_BY_ME',
                                },
                                {
                                    name: 'claimed by me',
                                    value: 'CLAIMED_BY_ME',
                                },
                                {
                                    name: 'drafted by me',
                                    value: 'DRAFTED_BY_ME',
                                },
                                {
                                    name: 'claimed by me and completed',
                                    value: 'CLAIMED_BY_ME_AND_COMPLETE',
                                },
                                {
                                    name: 'open',
                                    value: 'OPEN',
                                },
                                {
                                    name: 'in progress',
                                    value: 'IN_PROGRESS',
                                },
                            ],
                            required: true,
                        },
                    ],
                },
                {
                    name: Activities.delete,
                    type: CommandOptionType.SUB_COMMAND,
                    description: 'Delete an open or in draft bounty',
                    options: [
                        {
                            name: 'bounty-id',
                            type: CommandOptionType.STRING,
                            description: 'Bounty ID',
                            required: true,
                        },
                    ],
                },
                {
                    name: 'gm',
                    type: CommandOptionType.SUB_COMMAND,
                    description: 'GM GM GM GM',
                },
                {
                    name: Activities.help,
                    type: CommandOptionType.SUB_COMMAND,
                    description: 'FAQ for using bounty commands',
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
            case Activities.publish:
                request = new PublishRequest({
                    commandContext: commandContext,
                    messageReactionRequest: null,
                    directRequest: null
                });
                break;
            case Activities.claim:
                request = new ClaimRequest({
                    commandContext: commandContext,
                    messageReactionRequest: null
                });
                break;
            case Activities.apply:
                request = new ApplyRequest({
                    commandContext: commandContext,
                    messageReactionRequest: null
                });
                break;
            case Activities.assign:
                request = new AssignRequest({
                    commandContext: commandContext,
                    messageReactionRequest: null
                });
                break;
            case Activities.submit:
                request = new SubmitRequest({
                    commandContext: commandContext,
                    messageReactionRequest: null
                });
                break;
            case Activities.complete:
                request = new CompleteRequest({
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
            case 'gm':
                request = new GmRequest({
                    commandContext : commandContext
                })
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