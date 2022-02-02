import { Role } from "discord.js";
import { DiscordEvent } from "../types/discord/DiscordEvent";
import { upsertCustomerRoles } from "../activity/roles/CustomerRoles";
import { UpsertCustomerRolesRequest } from "../requests/UpsertCustomerRolesRequest";
import { LogUtils } from "../utils/Log";

export default class implements DiscordEvent {
    name = 'roleCreate';
    once = false;

    async execute(role: Role): Promise<void> {
        await this.roleCreateHandler(role);
    }

    async roleCreateHandler(role: Role) {
        const request = await UpsertCustomerRolesRequest.build(role);

        try {
            await upsertCustomerRoles(request)
        } catch (e) {
            LogUtils.logError('Updating Customer Roles failed', e);
        }
    }
    

}