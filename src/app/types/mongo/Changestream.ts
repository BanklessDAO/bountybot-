import { BountyCollection } from "../bounty/BountyCollection";

export interface ChangeStreamEvent {
    operationType: string,
    fullDocument: BountyCollection,
}