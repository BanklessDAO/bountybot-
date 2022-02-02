import { Role } from "discord.js";
import { upsertCustomerRoles } from "../activity/roles/CustomerRoles";
import { UpsertCustomerRolesRequest } from "../requests/UpsertCustomerRolesRequest";
import { DiscordEvent } from "../types/discord/DiscordEvent";
import { LogUtils } from "../utils/Log";

export default class implements DiscordEvent {
    name = 'roleDelete';
    once = false;

    async execute(role: Role): Promise<void> {
        await this.roleDeleteHandler(role);
    }

    async roleDeleteHandler(role: Role) {
        const request = await UpsertCustomerRolesRequest.build(role);

        try {
            await upsertCustomerRoles(request)
        } catch (e) {
            LogUtils.logError('Updating Customer Roles failed', e);
        }
    }

}