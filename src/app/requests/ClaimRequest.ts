import { CommandContext } from 'slash-create';
import { Request } from './Request';
import { MessageReactionRequest } from '../types/discord/MessageReactionRequest';
import { Activities } from '../constants/activities';
import { ButtonInteraction, Message } from 'discord.js';
import DiscordUtils from '../utils/DiscordUtils';
import { ChangeStreamEvent } from '../types/mongo/ChangeStream';

export class ClaimRequest extends Request {
    bountyId: string;
    
    commandContext: CommandContext;
    message: Message;
    buttonInteraction: ButtonInteraction;

    constructor(args: {
        commandContext: CommandContext, 
        messageReactionRequest: MessageReactionRequest,
        clientSyncRequest: ChangeStreamEvent,
        buttonInteraction: ButtonInteraction,
        directRequest: {
            guildId: string,
            bountyId: string,
            userId: string,
            activity: string
            bot: boolean,
        }
    }) {
        if (args.commandContext) {
            if (args.commandContext.subcommands[0] !== Activities.claim) {
                throw new Error('ClaimRequest attempted created for non Claim activity.');
            }
            super(args.commandContext.subcommands[0], args.commandContext.guildID, args.commandContext.user.id, args.commandContext.user.bot);
            this.commandContext = args.commandContext;
            this.bountyId = args.commandContext.options.claim['bounty-id'];
        } 
        else if (args.messageReactionRequest) {
            const messageReactionRequest: MessageReactionRequest = args.messageReactionRequest;
            super(Activities.claim, messageReactionRequest.message.guildId, messageReactionRequest.user.id, messageReactionRequest.user.bot);
            this.message = messageReactionRequest.message;
            this.buttonInteraction = args.buttonInteraction;
            this.bountyId = DiscordUtils.getBountyIdFromEmbedMessage(messageReactionRequest.message);
        } 
        else if (args.clientSyncRequest) {
            const upsertedBountyRecord = args.clientSyncRequest.fullDocument;
            const claimantUserId = upsertedBountyRecord.claimedBy.discordId
            super(Activities.claim, upsertedBountyRecord.customerId, claimantUserId, false);
            this.bountyId = upsertedBountyRecord._id;
            this.clientSyncRequest = true;
        }
        else if (args.directRequest) {
            const { guildId, bountyId, userId, activity, bot } = args.directRequest;
            super (activity, guildId, userId, bot);

            this.bountyId = bountyId;
            this.buttonInteraction = args.buttonInteraction;
        }
    }
}