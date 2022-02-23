import { BountyCollection } from "../bounty/BountyCollection";

export interface ChangestreamEvent {
    operationType: string,
    fullDocument: BountyCollection,
}