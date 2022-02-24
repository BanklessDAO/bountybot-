import { BountyCollection } from "../bounty/BountyCollection";

export interface ChangeStreamEvent {
    _id: {
        _data: string,
    }
    operationType: string,
    fullDocument: BountyCollection,
    documentKey: {
        _id: string,
    },
    updateDescription: {
        updatedFields: BountyCollection,
        removedFields: BountyCollection,
    }
    
}