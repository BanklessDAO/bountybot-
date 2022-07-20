import AuthorizationModule from "../../auth/commandAuth";
import ValidationModule from "../../validation/commandValidation";
import { BountyActivityHandler } from "./ActivityHandler";
import Log from '../../utils/Log';
import BountyUtils from "../../utils/BountyUtils";

/**
 * handler is responsible for the flow of any activity request.
 * Slash commands and message reaction events will route through this handler.
 * handler is not responsible for error handling and status messages to the user
 * handler is called by Bounty::run, MessageReactionAdd: messageReactionHandler, Create::handleBountyReaction
 * @param request 
 * @returns an empty Promise for error handling and async calls
 */
export const handler = async (request: any): Promise<void> => {
    Log.debug(`In Handler: Bounty ID: ${request.bountyId} Actvity: ${request.activity}`);

    setTimeout(async ()=> {
        if (request.buttonInteraction && !(request.buttonInteraction.replied || request.buttonInteraction.deferred)) {
            await request.buttonInteraction.deferReply({ ephemeral: true }).catch(e => Log.debug(`Error: ${e.message}`));
        } else if (request.commandContext && !request.commandContext.initiallyResponded) {
            await request.commandContext.defer();
        }
    }, 2000);

    await ValidationModule.run(request);

    await AuthorizationModule.run(request);

    await BountyActivityHandler.run(request);

    if (request.bountyId) await BountyUtils.bountyCleanUp(request.bountyId);
}