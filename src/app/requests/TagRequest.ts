import { CommandContext } from 'slash-create';
import { Request } from './Request';
import { MessageReactionRequest } from '../types/discord/MessageReactionRequest';
import { Activities } from '../constants/activities';
import { Message } from 'discord.js';
import DiscordUtils from '../utils/DiscordUtils';

export class TagRequest extends Request {
    bountyId: string;
    tag: string;
    
    commandContext: CommandContext;
    message: Message;

    constructor(args: {
        commandContext: CommandContext, 
        messageReactionRequest: MessageReactionRequest
    }) {
        if (args.commandContext) {
            if (args.commandContext.subcommands[0] !== Activities.tag) {
                throw new Error(`${Activities.tag}Request created for non ${Activities.tag} activity.`);
            }
            super(args.commandContext.subcommands[0], args.commandContext.guildID, args.commandContext.user.id, args.commandContext.user.bot);
            this.commandContext = args.commandContext;
            this.bountyId = args.commandContext.options.tag['bounty-id'];
            this.tag = args.commandContext.options.tag['tag'];
        } else if (args.messageReactionRequest) {
            const messageReactionRequest: MessageReactionRequest = args.messageReactionRequest;
            super(Activities.tag, messageReactionRequest.message.guildId, messageReactionRequest.user.id, messageReactionRequest.user.bot);
            this.message = messageReactionRequest.message;
            this.bountyId = DiscordUtils.getBountyIdFromEmbedMessage(messageReactionRequest.message);
        }
    }
}