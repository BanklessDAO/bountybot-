import mongo, { Db } from "mongodb";
import { Request } from "../requests/Request";
import { BountyCollection } from "../types/bounty/BountyCollection";
import DiscordUtils from "./DiscordUtils";
import MongoDbUtils from "./MongoDbUtils";

const ErrorUtils = {
    sendToDefaultChannel: async (message: string, request: any) => {
        const user = await DiscordUtils.getGuildMemberFromUserId(request.userId, request.guildId);
        const bountyChannel = await DiscordUtils.getBountyChannelfromCustomerId(request.guildId);

        await bountyChannel.send({
            embeds: [{
                title: 'Bounty Notification',
                fields: [{
                    name: 'For User',
                    value: `<@${user.id}>`,
                }, {
                    name: 'Message',
                    value: message,
                }],
                footer: {
                    text: `Please turn on your DMs for direct notifications.`
                }
            }],

        });
    },
    sendIOUToDefaultChannel: async (message: string, request: any) => {
        const user = await DiscordUtils.getGuildMemberFromUserId(request.owedTo, request.guildId);
        const bountyChannel = await DiscordUtils.getBountyChannelfromCustomerId(request.guildId);

        await bountyChannel.send({
            embeds: [{
                title: 'IOU Notification',
                fields: [{
                    name: 'For User',
                    value: `<@${user.id}>`,
                }, {
                    name: 'Message',
                    value: message,
                }],
                footer: {
                    text: `Please turn on your DMs for direct notifications.`
                }
            }]
        });
    },
}

export default ErrorUtils;