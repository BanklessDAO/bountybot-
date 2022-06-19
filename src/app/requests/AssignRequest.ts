import { CommandContext } from 'slash-create';
import { Request } from './Request';
import { MessageReactionRequest } from '../types/discord/MessageReactionRequest';
import { Activities } from '../constants/activities';
import { ButtonInteraction, Message } from 'discord.js';

export class AssignRequest extends Request {
    bountyId: string;
    assign: string;
    
    commandContext: CommandContext;
    message: Message;
    buttonInteraction: ButtonInteraction;

    constructor(args: {
        commandContext: CommandContext, 
        messageReactionRequest: MessageReactionRequest,
        buttonInteraction: ButtonInteraction,
    }) {
        if (args.commandContext) {

            if (args.commandContext.subcommands[0] !== Activities.assign) {
                throw new Error('AssignRequest attempted created for non Assign activity.');
            }
            super(args.commandContext.subcommands[0], args.commandContext.guildID, args.commandContext.user.id, args.commandContext.user.bot);
            this.commandContext = args.commandContext;
            this.bountyId = args.commandContext.options.assign['bounty-id'];
            this.assign = args.commandContext.options.assign['for-user'];

        } else {
            // TODO add flow to assign though message reaction
            throw new Error('Assign context is required to be not null for AssignRequest construction.');
        }
    }
}