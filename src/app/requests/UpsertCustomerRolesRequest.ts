import { Role } from "discord.js";
import RuntimeError from "../errors/RuntimeError";
import DiscordUtils from "../utils/DiscordUtils";

export class UpsertCustomerRolesRequest {
    customerId: string;
    customerName: string;

    constructor(args: {
        role: Role,
        customerName: string,
    }) {
        if (args.role) {
            this.customerId = args.role.guild.id;
        }
        else {
            throw new RuntimeError(new Error('Attempted UpsertCustomerRolesRequest without a role specified.'));
        }

        if (args.customerName) {
            this.customerName = args.customerName;
        }
    }

    static async build(role: Role) {
        const customerName = await DiscordUtils.getGuildNameFromGuildId(role.guild.id);
        return new UpsertCustomerRolesRequest({
            role: role,
            customerName: customerName,
        });
    }

}