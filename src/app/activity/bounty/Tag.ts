import mongo, { Db, UpdateWriteOpResult } from "mongodb";
import { TagRequest } from "../../requests/TagRequest";
import Log from "../../utils/Log"
import MongoDbUtils from "../../utils/MongoDbUtils";

export const tagBounty = async (request: TagRequest): Promise<void> => {
    Log.debug(`In Tag activity`);

    return await writeDbHandler(request);
}

const writeDbHandler = async (request: TagRequest): Promise<void> => {
    const db: Db = await MongoDbUtils.connect('bountyboard');
	const bountyCollection = db.collection('bounties');

	const writeResult: UpdateWriteOpResult = await bountyCollection.updateOne( {_id: new mongo.ObjectId(request.bountyId)}, {
		$set: {
			tag: request.tag,
		},
	});
}