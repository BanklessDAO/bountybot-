import {
    CommandContext,
    CommandOptionType,
    SlashCommand,
    SlashCreator,
} from 'slash-create';
import { handler } from '../../activity/bounty/Handler';

import ValidationError from '../../errors/ValidationError';
import AuthorizationError from '../../errors/AuthorizationError';
import Log, { LogUtils } from '../../utils/Log';
import { Request } from '../../requests/Request';
import { guildIds } from '../../constants/customerIds';
import { Activities } from '../../constants/activities';
import { UpsertUserWalletRequest } from '../../requests/UpsertUserWalletRequest';
import DiscordUtils from '../../utils/DiscordUtils';

export default class Wallet extends SlashCommand {
    constructor(creator: SlashCreator) {
        super(creator, {
            name: Activities.registerWallet,
            description: 'Register your wallet address to get paid by bounty creators.',
            //TODO: make this dynamic? - can pull guildId list by querying mongo from app.ts on startup
            guildIDs: guildIds,
            options: [
                    {
                        name: 'eth-wallet-address',
                        type: CommandOptionType.STRING,
                        description: 'Enter your ethereum wallet address',
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
    async run(commandContext: CommandContext): Promise<any> {
        // TODO: migrate to adding handlers to array
        // core-logic of any Activity:
        // request initiator (slash command, message reaction, dm reaction callback)
        // Auth check
        // validate/sanitize user input
        // Parse user input into database/api call
        // Successful db/API response --> user success handling + embed update, allow request initiator to delete original /bounty message
        // Error db/API response --> throw error, allow request initiator to handle logging, and graceful error message to users
        Log.debug(`Slash command triggered for ${commandContext.subcommands[0]}`);

        const request = new UpsertUserWalletRequest({
            userDiscordId: commandContext.user.id,
            address: commandContext.options['eth-wallet-address']

        })
        //const { guildMember } = await DiscordUtils.getGuildAndMember(commandContext.guildID, commandContext.user.id);

        try {
            await handler(request)
        }
        catch (e) {
            if (e instanceof ValidationError) {
                await commandContext.send(`<@${commandContext.user.id}>\n` + e.message, { ephemeral: true });
                return;
            } else if (e instanceof AuthorizationError) {
                await commandContext.send(`<@${commandContext.user.id}>\n` + e.message, { ephemeral: true });
                return;
            }
            else {
                LogUtils.logError('error', e);
                await commandContext.send('Sorry something is not working and our devs are looking into it.', { ephemeral: true });
                await commandContext.delete();
                return;
            }
        }

        return await commandContext.send(`<@${request.userDiscordId}>, registered wallet address ${request.address}`, { ephemeral: true });

    }
}