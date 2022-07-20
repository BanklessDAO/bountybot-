import { CommandContext } from 'slash-create'
import { Request } from './Request'
import { Activities } from '../constants/activities';
import { MessageReactionRequest } from '../types/discord/MessageReactionRequest';
import { ButtonInteraction, Message } from 'discord.js';

export class ListRequest extends Request {
    listType: string;
    commandContext: CommandContext;
    message: Message;
    buttonInteraction: ButtonInteraction;

    constructor(args: {
        commandContext: CommandContext, 
        messageReactionRequest: MessageReactionRequest,
        listType: string,
        buttonInteraction: ButtonInteraction,
    }) {
        if (args.commandContext) {
            if (args.commandContext.subcommands[0] !== Activities.list) {
                throw new Error('ListRequest created for non List activity.');
            }
            super(args.commandContext.subcommands[0], args.commandContext.guildID, args.commandContext.user.id, args.commandContext.user.bot);
            this.listType = args.commandContext.options.list['list-type'];
            this.commandContext = args.commandContext;
        } else if (args.messageReactionRequest) {
            const messageReactionRequest: MessageReactionRequest = args.messageReactionRequest;
            super(Activities.list, messageReactionRequest.message.guildId, messageReactionRequest.user.id, messageReactionRequest.user.bot);
            this.message = messageReactionRequest.message;
            this.buttonInteraction = args.buttonInteraction;
            this.listType = args.listType;
        } 

        else {
            throw new Error('ListRequest needs a non null commandContext')
        }
    }
}