import { CommandContext } from 'slash-create'
import { Request } from './Request'
import { MessageReactionRequest } from '../types/discord/MessageReactionRequest';
import { Activities } from '../constants/activities';
import { Message } from 'discord.js';
import DiscordUtils from '../utils/DiscordUtils';

export class PaidRequest extends Request {
    bountyId: string;
    resolutionNote: string;
    commandContext: CommandContext;

    message: Message;
    
    constructor(args: {
        commandContext: CommandContext, 
        messageReactionRequest: MessageReactionRequest
    }) {
        if (args.commandContext) {
            let commandContext: CommandContext = args.commandContext;
            if (commandContext.subcommands[0] !== Activities.paid) {
                throw new Error('PaidRequest attempted created for non Paid activity.');
            }
            super(Activities.paid, commandContext.guildID, args.commandContext.user.id, args.commandContext.user.bot);
            this.commandContext = commandContext;
            this.bountyId = commandContext.options.paid['iou-id'];
            this.resolutionNote = commandContext.options.paid['notes'];
        }
        else if (args.messageReactionRequest) {
            let messageReactionRequest: MessageReactionRequest = args.messageReactionRequest;
            super(Activities.paid, messageReactionRequest.message.guildId, messageReactionRequest.user.id, messageReactionRequest.user.bot);
            this.message = messageReactionRequest.message;
            this.bountyId = DiscordUtils.getBountyIdFromEmbedMessage(messageReactionRequest.message);
        }
    }
}