import { Activities } from "../constants/activities";
import { Clients } from "../constants/clients";
import { BountyCollection } from "../types/bounty/BountyCollection";
import { ChangestreamEvent } from "../types/mongo/Changestream";
import Log from "../utils/Log";

export const ClientSync = async (args: {changeStreamEvent: ChangestreamEvent}): Promise<void> => {
    if (args.changeStreamEvent.fullDocument) {
        const activityHistory = args.changeStreamEvent.fullDocument.activityHistory;
        console.log('here');
        if (activityHistory && activityHistory[activityHistory.length - 1].client != Clients.bountybot) {
            changeStreamEventHandler(args.changeStreamEvent.fullDocument);
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
const changeStreamEventHandler= async (modifiedRecord: BountyCollection): Promise<void> => {
    let request: any;
    const interactionHistory = modifiedRecord.activityHistory;
    const activity = interactionHistory[interactionHistory.length - 1].activity;
    Log.info(`Processing ${activity} activity event. Origination: ${Clients.bountyboardweb}`);
    switch (activity) {
        case Activities.create:
            // no-op
            break;
        case Activities.publish:
            Log.info('verify new bounty received')
            break;
        case Activities.claim:
            Log.info('verify bounty claimed')
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
}