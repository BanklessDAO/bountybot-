import  { CommandContext } from 'slash-create';
import { Request } from './Request';
import { Activities } from '../constants/activities';

export class CreateRequest extends Request {
    userId: string;
    guildId: string;
    title: string;
    reward: string;
    evergreen: boolean;
    claimLimit: number;
    copies: number;
    gate: string;
    assign: string;
    assignedName: string;

    // TODO: remove
    commandContext: CommandContext;


    constructor(args: {
        commandContext: CommandContext, 
    }) {
        if (args.commandContext) {
            const commandContext: CommandContext = args.commandContext;
            if (commandContext.subcommands[0] !== Activities.create) {
                throw new Error('CreateRequest attempted for non Create activity.');
            }
            super(commandContext.subcommands[0], commandContext.guildID, args.commandContext.user.id, args.commandContext.user.bot);
            this.userId = commandContext.user.id;
            this.title = commandContext.options.create['title'];
            this.reward = commandContext.options.create['reward'];
            this.evergreen = commandContext.options.create['evergreen'];
            this.claimLimit = commandContext.options.create['claim-limit'];
            this.gate = commandContext.options.create['gate'];
            this.assign = commandContext.options.create['assign']

            // TODO: remove
            this.commandContext = commandContext;
        } else {
            throw new Error('Command context is required to be not null for CreateRequest construction.');
        }
    }
}