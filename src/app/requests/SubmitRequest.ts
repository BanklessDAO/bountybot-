import { CommandContext } from 'slash-create'
import { Request } from './Request'
import { MessageReactionRequest } from '../types/discord/MessageReactionRequest';
import { Activities } from '../constants/activities';
import { ButtonInteraction, Message } from 'discord.js';
import DiscordUtils from '../utils/DiscordUtils';

export class SubmitRequest extends Request {
    bountyId: string;
    url: string;
    notes: string;

    commandContext: CommandContext;
    message: Message;
    buttonInteraction: ButtonInteraction;

    constructor(args: {
        commandContext: CommandContext, 
        messageReactionRequest: MessageReactionRequest,
        buttonInteraction: ButtonInteraction,
    }) {
        if (args.commandContext) {
            let commandContext: CommandContext = args.commandContext;
            if (commandContext.subcommands[0] !== Activities.submit) {
                throw new Error('SubmitRequest attempted created for non Submit activity.');
            }
            super(commandContext.subcommands[0], commandContext.guildID, args.commandContext.user.id, args.commandContext.user.bot);
            this.bountyId = commandContext.options.submit['bounty-id'];
            this.url = commandContext.options.submit['url'];
            this.notes = commandContext.options.submit['notes'];

            this.commandContext = commandContext;
        }
        else if (args.messageReactionRequest) {
            let messageReactionRequest: MessageReactionRequest = args.messageReactionRequest;
            super(Activities.submit, messageReactionRequest.message.guildId, messageReactionRequest.user.id, messageReactionRequest.user.bot);
            this.message = messageReactionRequest.message;
            this.bountyId = DiscordUtils.getBountyIdFromEmbedMessage(messageReactionRequest.message);
            this.buttonInteraction = args.buttonInteraction;
        }
    }
}