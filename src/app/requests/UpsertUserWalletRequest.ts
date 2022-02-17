import { Activities } from '../constants/activities';

export class UpsertUserWalletRequest {
    userDiscordId: string;
    address: string;
    activity: string;

    constructor(args: {
        userDiscordId: string,
        address: string,
    }) {
        if (args.userDiscordId && args.address) {
            this.userDiscordId = args.userDiscordId;
            this.address = args.address;
            this.activity = Activities.registerWallet;
        }
        else {
            throw new Error("userDiscordId and address must both be set");
        }
    }
}