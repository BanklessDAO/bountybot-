import { BountyCollection } from "../bounty/BountyCollection";

export interface ChangeStreamEvent {
    operationType: string,
    fullDocument: BountyCollection,
    documentKey: {
        _id: string,
    },
    updateDescription: {
        updatedFields: BountyCollection,
        removedFields: Array<keyof BountyCollection>,
    }
    
}