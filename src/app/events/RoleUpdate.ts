import { Role } from "discord.js";
import { upsertCustomerRoles } from "../activity/roles/CustomerRoles";
import { UpsertCustomerRolesRequest } from "../requests/UpsertCustomerRolesRequest";
import { DiscordEvent } from "../types/discord/DiscordEvent";
import { LogUtils } from "../utils/Log";

export default class implements DiscordEvent {
    name = 'roleUpdate';
    once = false;

    async execute(oldRole: Role, newRole: Role): Promise<void> {
        await this.roleUpdateHandler(oldRole, newRole);
    }

    async roleUpdateHandler(oldRole: Role, newRole: Role) {
        const request = await UpsertCustomerRolesRequest.build(newRole);

        try {
            await upsertCustomerRoles(request)
        } catch (e) {
            LogUtils.logError('Updating Customer Roles failed', e);
        }
    }

}