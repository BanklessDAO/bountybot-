import { CommandContext } from 'slash-create';
import { Request } from './Request';
import { MessageReactionRequest } from '../types/discord/MessageReactionRequest';
import { Activities } from '../constants/activities';
import { Message } from 'discord.js';
import DiscordUtils from '../utils/DiscordUtils';

export class ClaimRequest extends Request {
    bountyId: string;
    
    commandContext: CommandContext;
    message: Message;

    constructor(args: {
        commandContext: CommandContext, 
        messageReactionRequest: MessageReactionRequest
    }) {
        if (args.commandContext) {
            if (args.commandContext.subcommands[0] !== Activities.claim) {
                throw new Error('ClaimRequest attempted created for non Claim activity.');
            }
            super(args.commandContext.subcommands[0], args.commandContext.guildID, args.commandContext.user.id, args.commandContext.user.bot);
            this.commandContext = args.commandContext;
            this.bountyId = args.commandContext.options.claim['bounty-id'];
        } else if (args.messageReactionRequest) {
            const messageReactionRequest: MessageReactionRequest = args.messageReactionRequest;
            super(Activities.claim, messageReactionRequest.message.guildId, messageReactionRequest.user.id, messageReactionRequest.user.bot);
            this.message = messageReactionRequest.message;
            this.bountyId = DiscordUtils.getBountyIdFromEmbedMessage(messageReactionRequest.message);
        }
    }
}