import  { CommandContext } from 'slash-create';
import { Request } from './Request';
import { Activities } from '../constants/activities';

export class IOURequest extends Request {
    userId: string;
    guildId: string;
    title: string;
    reward: string;
    owedTo: string;

    // TODO: remove
    commandContext: CommandContext;


    constructor(args: {
        commandContext: CommandContext, 
    }) {
        if (args.commandContext) {
            const commandContext: CommandContext = args.commandContext;
            if (commandContext.subcommands[0] !== Activities.iou) {
                throw new Error('IOURequest attempted for non IOU activity.');
            }
            super(commandContext.subcommands[0], commandContext.guildID, args.commandContext.user.id, args.commandContext.user.bot);
            this.userId = commandContext.user.id;
            this.title = commandContext.options.iou['title'];
            this.reward = commandContext.options.iou['reward'];
            this.owedTo = commandContext.options.iou['owed-to'];
            

            // TODO: remove
            this.commandContext = commandContext;
        } else {
            throw new Error('Command context is required to be not null for IOURequest construction.');
        }
    }
}