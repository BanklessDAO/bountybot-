import { CommandContext } from 'slash-create';
import { Request } from './Request';
import { MessageReactionRequest } from '../types/discord/MessageReactionRequest';
import { Activities } from '../constants/activities';
import { ButtonInteraction, Message } from 'discord.js';
import DiscordUtils from '../utils/DiscordUtils';

export class ApplyRequest extends Request {
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
            if (args.commandContext.subcommands[0] !== Activities.apply) {
                throw new Error('ApplyRequest attempted created for non Apply activity.');
            }
            super(args.commandContext.subcommands[0], args.commandContext.guildID, args.commandContext.user.id, args.commandContext.user.bot);
            this.commandContext = args.commandContext;
            this.bountyId = args.commandContext.options.apply['bounty-id'];
        } else if (args.messageReactionRequest) {
            const messageReactionRequest: MessageReactionRequest = args.messageReactionRequest;
            super(Activities.apply, messageReactionRequest.message.guildId, messageReactionRequest.user.id, messageReactionRequest.user.bot);
            this.message = messageReactionRequest.message;
            this.buttonInteraction = args.buttonInteraction;
            this.bountyId = DiscordUtils.getBountyIdFromEmbedMessage(messageReactionRequest.message);
        }
    }
}