import { CommandContext } from 'slash-create';
import { Request } from './Request';
import { MessageReactionRequest } from '../types/discord/MessageReactionRequest';
import { Activities } from '../constants/activities';
import { Message } from 'discord.js';

export class AssignRequest extends Request {
    bountyId: string;
    assign: string;
    
    commandContext: CommandContext;
    message: Message;

    constructor(args: {
        commandContext: CommandContext, 
        messageReactionRequest: MessageReactionRequest
    }) {
        if (args.commandContext) {

            if (args.commandContext.subcommands[0] !== Activities.assign) {
                throw new Error('AssignRequest attempted created for non Assign activity.');
            }
            super(args.commandContext.subcommands[0], args.commandContext.guildID, args.commandContext.user.id, args.commandContext.user.bot);
            this.commandContext = args.commandContext;
            this.bountyId = args.commandContext.options.assign['bounty-id'];
            this.assign = args.commandContext.options.assign['assign-to'];

        } else {
            // TODO add flow to assign though message reaction
            throw new Error('Assign context is required to be not null for AssignRequest construction.');
        }
    }
}