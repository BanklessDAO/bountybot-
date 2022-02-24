export class Request {
    activity: string;
    guildId: string;
    userId: string;
    bot: boolean;
    clientSyncRequest: boolean;
    // TODO: Is it better for commandContext and MessageReactionAdd to be parsed here as well as in the child classes?
    //      The constructor args are getting unwieldy
    constructor(activity: string, guildId: string, userId: string, bot: boolean) {
        this.activity = activity;
        this.guildId = guildId;
        this.userId = userId;
        this.bot = bot;
    }
}

