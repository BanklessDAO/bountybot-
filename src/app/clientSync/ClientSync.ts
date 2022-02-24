import { handler } from "../activity/bounty/Handler";
import { Activities } from "../constants/activities";
import { Clients } from "../constants/clients";
import AuthorizationError from "../errors/AuthorizationError";
import RuntimeError from "../errors/RuntimeError";
import ValidationError from "../errors/ValidationError";
import { ClaimRequest } from "../requests/ClaimRequest";
import { PublishRequest } from "../requests/PublishRequest";
import { BountyCollection } from "../types/bounty/BountyCollection";
import { ChangeStreamEvent } from "../types/mongo/ChangeStream";
import Log, { LogUtils } from "../utils/Log";

export const ClientSync = async (args: {changeStreamEvent: ChangeStreamEvent}): Promise<void> => {
    if (args.changeStreamEvent.fullDocument) {
        const activityHistory = args.changeStreamEvent.fullDocument.activityHistory;
        console.log('here');
        if (activityHistory && activityHistory[activityHistory.length - 1].client != Clients.bountybot) {
            changeStreamEventHandler(args.changeStreamEvent);
        } else {
            // no-op: don't process bot changes to the db
            console.log('no activity history');
        }
    }
}

/**
 * Handles the object passed from a mongodb changestream listener.
 * Transforms changeStreamEvent to a *Request object that can be processed by /bounty activity classes.
 * @param changeStreamEvent
 *     The object passed from the mongodb changestream listener
 */
const changeStreamEventHandler= async (event: ChangeStreamEvent): Promise<void> => {
    let request: any;
    const interactionHistory = event.fullDocument.activityHistory;
    const lastClientActivity = interactionHistory[interactionHistory.length - 1];
    const activity = lastClientActivity.activity;
    Log.info(`Processing ${activity} activity event. Origination: ${Clients.bountyboardweb}`);
    switch (activity) {
        case Activities.create:
            // no-op
            break;
        case Activities.publish:
            Log.info('verify new bounty received');
            // TODO: add field to front end
            event.fullDocument.requireApplication = false;
            console.log(event.fullDocument.requireApplication);
            request = new PublishRequest({
                commandContext: null,
                messageReactionRequest: null,
                directRequest: null,
                clientSyncRequest: event,
            });
            break;
        case Activities.claim:
            Log.info('verify bounty claimed')
            request = new ClaimRequest({
                commandContext: null,
                messageReactionRequest: null,
                clientSyncRequest: event,
            });
            break;
        case Activities.submit:
            break;
        case Activities.complete:
            break;
        case Activities.delete:
            break;
        default:
            Log.info('default case: invalid activity');
            break;
    }

    try {
        console.dir(request);
        await handler(request); 
    }
    catch (e) {
        if (e instanceof ValidationError) {
            // TO-DO: Consider adding a User (tag, id) metadata field to logging objects
            Log.info(`${lastClientActivity.client} submitted a request for ${event.fullDocument._id} that failed validation`);
            return;
        } else if (e instanceof AuthorizationError) {
            Log.info(`${lastClientActivity.client} submitted a request for ${event.fullDocument._id} that failed authorization`);
            return;
        }
        else {
            LogUtils.logError(`client sync error for for ${event.fullDocument._id}: `, e);
        }
    }

}