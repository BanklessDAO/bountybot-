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
import { CreateRequest } from '../../requests/CreateRequest';
import AuthorizationError from '../../errors/AuthorizationError';
import DiscordUtils from '../../utils/DiscordUtils';
import { guildIds } from '../../constants/customerIds';


export default class IOU extends SlashCommand {
    constructor(creator: SlashCreator) {
        super(creator, {
            name: 'iou',
            description: 'Create an IOU, a quick bounty for work already completed.',
            guildIDs: guildIds,
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
        Log.debug(`Slash command triggered for iou`);
        let request: any;
        request = new CreateRequest({
            commandContext: commandContext 
        });
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