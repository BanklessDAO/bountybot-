import { CommandContext } from 'slash-create'
import { Request } from './Request'
import { MessageReactionRequest } from '../types/discord/MessageReactionRequest';
import { Activities } from '../constants/activities';
import { Message } from 'discord.js';
import DiscordUtils from '../utils/DiscordUtils';

export class DeleteRequest extends Request {
    bountyId: string;
    resolutionNote: string;
    commandContext: CommandContext;

    message: Message;
    
    constructor(args: {
        commandContext: CommandContext, 
        messageReactionRequest: MessageReactionRequest
        directRequest: {
            bountyId: string,
            guildId: string,
            userId: string,
            activity: string,
            resolutionNote: string,
            bot: boolean 
        }
    }) {
        if (args.commandContext) {
            let commandContext: CommandContext = args.commandContext;
            if (commandContext.subcommands[0] !== Activities.delete) {
                throw new Error('DeleteRequest attempted created for non Delete activity.');
            }
            super(commandContext.subcommands[0], commandContext.guildID, commandContext.user.id, commandContext.user.bot);
            const isIOU = commandContext.commandName == 'iou' ? true : false;
            this.commandContext = commandContext;
            if (isIOU) {
                this.bountyId = commandContext.options.delete['iou-id'];
            } else {
                this.bountyId = commandContext.options.delete['bounty-id'];
            }
            this.resolutionNote = commandContext.options.delete['notes'];
        }
        else if (args.messageReactionRequest) {
            let messageReactionRequest: MessageReactionRequest = args.messageReactionRequest;
            super(Activities.delete, messageReactionRequest.message.guildId, messageReactionRequest.user.id, messageReactionRequest.user.bot);
            this.bountyId = DiscordUtils.getBountyIdFromEmbedMessage(messageReactionRequest.message);
        }
        else if (args.directRequest) {
            super(args.directRequest.activity, args.directRequest.guildId, args.directRequest.userId, args.directRequest.bot);
            this.bountyId = args.directRequest.bountyId;
            this.resolutionNote = args.directRequest.resolutionNote;

        }
    }
}