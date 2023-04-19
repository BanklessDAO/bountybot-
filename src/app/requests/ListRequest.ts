import { CommandContext } from 'slash-create';
import { Request } from './Request';
import { Activities } from '../constants/activities';
import { MessageReactionRequest } from '../types/discord/MessageReactionRequest';
import { ButtonInteraction, Message } from 'discord.js';

export class ListRequest extends Request {
    listType: string;
    commandContext: CommandContext;
    message: Message;
    buttonInteraction: ButtonInteraction;
    channelCategory: string;
    tag: string;

    constructor(args: {
        commandContext: CommandContext,
        messageReactionRequest: MessageReactionRequest,
        listType: string,
        buttonInteraction: ButtonInteraction,
    }) {
        if (args.commandContext) {
            super(
                Activities.list,
                args.commandContext.guildID,
                args.commandContext.user.id,
                args.commandContext.user.bot
            );

            // If we are calling List from another activity, assume generic list command
            if (args.commandContext.options.list) {
                this.listType = args.commandContext.options.list['list-type'];
                this.channelCategory = args.commandContext.options.list['channel-category'];
                this.tag = args.commandContext.options.list['tag'];
            }
            this.commandContext = args.commandContext;
        } else if (args.messageReactionRequest) {
            const messageReactionRequest: MessageReactionRequest = args.messageReactionRequest;

            // User will be null if this is triggered from a web update
            super(
                Activities.list,
                messageReactionRequest.message.guildId,
                messageReactionRequest.user?.id,
                messageReactionRequest.user?.bot
            );
            this.message = messageReactionRequest.message;
            // See if this list included tag and channel category filters (stored in footer)
            if (this.message.embeds && this.message.embeds[0]) {
                const footer = this.message.embeds[0].footer?.text;
                if (footer) {
                    const tagRegex = /^Tag:\s(.*)/m;
                    const foundTag = tagRegex.exec(footer);
                    console.log(`foundTag ${JSON.stringify(foundTag)}`);
                    if (foundTag) this.tag = foundTag[1];
                    console.log(`Tag: ${this.tag}`);

                    const categoryRegex = /^Channel Category:\s(.*)/m;
                    const foundCategory = categoryRegex.exec(footer);
                    if (foundCategory) this.channelCategory = foundCategory[1];
                }
            };
            this.buttonInteraction = args.buttonInteraction;
            this.listType = args.listType;
        } else {
            throw new Error('ListRequest needs a non null commandContext');
        }
    }
}

