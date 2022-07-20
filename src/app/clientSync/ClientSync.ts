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

/**
 * Handles some basic validation/safety logic to prevent unintentional double calls to activities.
 * For example, most bounty lifecycle activities require writing to the bounty record the channel id
 * and message id of the bounty card (whether in a Text or DM Channel). In that case, we don't want to kick
 * off the activity that generated that db operation.
 * The other case is that a user kicks off an activity on the bot, like claim. 
 * This will result in a write operation to the db, and we don't want to kick off the claim activity again. 
 * @param args an object containing the ChangeStreamEvent
 * @returns void promise
 */
export const ClientSync = async (args: {changeStreamEvent: ChangeStreamEvent}): Promise<void> => {
    // if OperationType is insert, updatedFields will be invalid
    let filterEvent = (
        "update" === args.changeStreamEvent.operationType && 
        !args.changeStreamEvent.updateDescription.updatedFields.activityHistory
    );
    
    if (filterEvent) {
        return;
    }
    
    if (args.changeStreamEvent.fullDocument) {
        const activityHistory = args.changeStreamEvent.fullDocument.activityHistory;
        if (activityHistory && activityHistory[activityHistory.length - 1].client != Clients.bountybot) {
            changeStreamEventHandler(args.changeStreamEvent);
        } else {
            // no-op: don't process bot changes to the db
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
    const activityHistory = event.fullDocument.activityHistory;
    const lastClientActivity = activityHistory[activityHistory.length - 1];
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
                buttonInteraction: null,
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