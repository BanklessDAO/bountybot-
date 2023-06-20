import  { CommandContext } from 'slash-create';
import { Request } from './Request';
import { Activities } from '../constants/activities';
import Log from '../utils/Log';

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
    requireApplication: boolean;
    owedTo: string;
    isIOU: boolean;
    createdInChannel: string;
    repeatDays: number;
    templateId: string;

    // TODO: remove
    commandContext: CommandContext;


    constructor(args: {
        commandContext: CommandContext, 
        templateId?: string,
        guildID?: string,
        userID?: string
    }) {
        Log.debug(`In CreateRequest`);
        if (args.commandContext) {
            const commandContext: CommandContext = args.commandContext;
            const isIOU = commandContext.commandName == 'iou' ? true : false;
            if (!isIOU && (commandContext.subcommands[0] !== Activities.create)) {
                throw new Error('CreateRequest attempted for non Create activity.');
            }
            super(Activities.create, commandContext.guildID, args.commandContext.user.id, args.commandContext.user.bot);
            this.createdInChannel = commandContext.channelID;
            this.userId = commandContext.user.id;
            if (isIOU) {
                this.title = commandContext.options['why'];
                this.owedTo = commandContext.options['owed-to'];
                this.isIOU = isIOU;
                this.reward = commandContext.options['reward'];
                this.repeatDays = commandContext.options['repeat-days'];
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
                this.reward = commandContext.options.create['reward'];
                this.repeatDays = commandContext.options.create['repeat-days'];
                }

            

            // TODO: remove
            this.commandContext = commandContext;
        } else if (args.templateId) {
            // Being called from the repeating bounty cron job
            super(Activities.create, args.guildID, args.userID, false);
            this.templateId = args.templateId;
        } else {
            throw new Error('Command context is required to be not null for CreateRequest construction.');
        }
    }
}