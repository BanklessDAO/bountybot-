import { CommandContext } from 'slash-create'
import { Request } from './Request'
import { Activities } from '../constants/activities';
import { MessageReactionRequest } from '../types/discord/MessageReactionRequest';
import { ButtonInteraction, Message } from 'discord.js';
import DiscordUtils from '../utils/DiscordUtils';

export class HelpRequest extends Request {
    bountyId: string;
    commandContext: CommandContext;

    message: Message;
    buttonInteraction: ButtonInteraction;

    constructor(args: {
        commandContext: CommandContext, 
        messageReactionRequest: MessageReactionRequest,
        buttonInteraction: ButtonInteraction,
    }) {
        if (args.commandContext) {
            if (args.commandContext.subcommands[0] !== Activities.help) {
                throw new Error('ListRequest created for non List activity.');
            }
            super(args.commandContext.subcommands[0], args.commandContext.guildID, args.commandContext.user.id, args.commandContext.user.bot);
            this.commandContext = args.commandContext;
            this.bountyId = args.commandContext.options.help['bounty-id'];
            // TODO: set HelpRequest fields
        }
        else if (args.messageReactionRequest) {
            let messageReactionRequest: MessageReactionRequest = args.messageReactionRequest;
            super(Activities.help, messageReactionRequest.message.guildId, messageReactionRequest.user.id, messageReactionRequest.user.bot);
            this.message = messageReactionRequest.message;
            this.buttonInteraction = args.buttonInteraction;
            this.bountyId = DiscordUtils.getBountyIdFromEmbedMessage(messageReactionRequest.message);
        }

        else {
            throw new Error('ListRequest needs a non null commandContext')
        }
    }
}