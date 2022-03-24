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
    requireApplication: boolean;
    owedTo: string;
    isIOU: boolean;

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
            const isIOU = commandContext.commandName == 'iou' ? true : false;
            super(commandContext.subcommands[0], commandContext.guildID, args.commandContext.user.id, args.commandContext.user.bot);
            this.userId = commandContext.user.id;
            if (isIOU) {
                this.title = commandContext.options.create['why'];
                this.owedTo = commandContext.options.create['owed-to'];
                this.isIOU = isIOU;
            } else {
                this.title = commandContext.options.create['title'];
                if (commandContext.options.create['claimants'] !== undefined) {  // Backwards compatible with old evergreen and claim-limit options
                    this.evergreen = true;
                    if (commandContext.options.create['claimants'] == 1) {  // 1 claimant is the same as NOT evergreen
                        this.evergreen = false;
                    } else if (commandContext.options.create['claimants'] !== 0) {    // 0 means NO claim limit
                        this.claimLimit = commandContext.options.create['claimants'];
                    }    
                }
                this.gate = commandContext.options.create['for-role'];
                this.assign = commandContext.options.create['for-user'];
                this.requireApplication = commandContext.options.create['require-application'];
                }

            this.reward = commandContext.options.create['reward'];
            

            // TODO: remove
            this.commandContext = commandContext;
        } else {
            throw new Error('Command context is required to be not null for CreateRequest construction.');
        }
    }
}