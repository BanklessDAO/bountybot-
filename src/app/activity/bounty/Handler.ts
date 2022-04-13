import AuthorizationModule from "../../auth/commandAuth";
import ValidationModule from "../../validation/commandValidation";
import { BountyActivityHandler } from "./ActivityHandler";
import Log from '../../utils/Log';

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

    await ValidationModule.run(request);

    await AuthorizationModule.run(request);

    await BountyActivityHandler.run(request);
}