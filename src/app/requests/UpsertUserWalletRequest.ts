import { ButtonInteraction } from 'discord.js';
import { CommandContext } from 'slash-create';
import { Activities } from '../constants/activities';

export class UpsertUserWalletRequest {
    userDiscordId: string;
    address: string;
    activity: string;
    commandContext: CommandContext;
    buttonInteraction: ButtonInteraction;
    callBack: (request: UpsertUserWalletRequest) => any | null;


    constructor(args: {
        userDiscordId: string,
        address: string,
        commandContext: CommandContext,
        buttonInteraction: ButtonInteraction,
        callBack: (request: UpsertUserWalletRequest) => any | null
    }) {
        if (args.userDiscordId) {
            this.userDiscordId = args.userDiscordId;
            this.address = args.address;
            this.commandContext = args.commandContext;
            this.buttonInteraction = args.buttonInteraction;
            this.callBack = args.callBack;
            this.activity = Activities.registerWallet;
        }
        else {
            throw new Error("userDiscordId must be set");
        }
    }
}