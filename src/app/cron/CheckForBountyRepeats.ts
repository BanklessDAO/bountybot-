import Log, { LogUtils } from '../utils/Log';
import DiscordUtils from '../utils/DiscordUtils';
import { BountyCollection } from '../types/bounty/BountyCollection';
import { CreateRequest } from '../requests/CreateRequest';
import { Cursor, Db } from 'mongodb';
import MongoDbUtils from '../utils/MongoDbUtils';
import { createBounty } from '../activity/bounty/Create';
import { BountyStatus } from '../constants/bountyStatus';
import { DeleteRequest } from '../requests/DeleteRequest';
import client from '../app';
import { Activities } from '../constants/activities';
import { deleteBounty } from '../activity/bounty/Delete';
import DMPermissionError from '../errors/DMPermissionError';

// This is called by the cron job. It will go through all bounty templates, find their latest instances
// and if we are beyond the repeat-days for the latest instance, create another.
export const checkForBountyRepeats = async (): Promise<void> => {

	Log.info('Cron: Checking for bounty repeats');
	const db: Db = await MongoDbUtils.connect('bountyboard');
	const bountyCollection = db.collection('bounties');

	const bountyTemplates: Cursor = bountyCollection.find({ 'isRepeatTemplate': true, status: { $ne: 'Deleted' } });

	Log.info(`${await bountyTemplates.hasNext() ? "Found templates" : "No templates found"}`);

	let customersAddedTo = new Map();

	while (await bountyTemplates.hasNext()) {
		// TODO need try-catch here
		const template: BountyCollection = await bountyTemplates.next();
		const lastChild: BountyCollection = await bountyCollection.findOne({ 'repeatTemplateId': template._id }, { sort: { 'createdAt': -1 } });
		if (lastChild) {
			Log.info(`Found last child ${lastChild._id}`)
			try {
				const lastCreatedAt = new Date(lastChild.createdAt);  // UTC
				const now = new Date();
				const timeDiff = Math.abs(now.getTime() - lastCreatedAt.getTime());
				//const daysDiff = Math.floor(timeDiff / (1000 * 3600 * 24));   **DOING HOURS FOR TESTING. TODO REPLACE WITH DAYS
				const daysDiff = Math.floor(timeDiff / (1000 * 360));
				console.log(`daysDiff: ${daysDiff} repeatDays: ${template.repeatDays}`);
				if (daysDiff >= template.repeatDays) {
					const createRequest: CreateRequest = new CreateRequest({ commandContext: null, templateId: template._id, guildID: template.customerId, userID: template.createdBy.discordId });
					createRequest.title = template.title;
					createRequest.reward = template.reward.amount + ' ' + template.reward.currency;
					createRequest.createdInChannel = template.createdInChannel;
					createRequest.evergreen = template.evergreen;
					createRequest.claimLimit = template.claimLimit;
					createRequest.requireApplication = template.requireApplication;
					createRequest.assign = template.assignTo?.discordId;
					if (template.gateTo) createRequest.gate = template.gateTo[0]?.discordId;
					createRequest.isIOU = template.isIOU;
					createRequest.owedTo = template.claimedBy?.discordId;
					createRequest.repeatDays = template.repeatDays;

					try {
						await createBounty(createRequest);
						if (!customersAddedTo.get(createRequest.guildId)) {
							customersAddedTo.set(createRequest.guildId, createRequest);
						}
					} catch (e) {
						if (e instanceof DMPermissionError) {
							LogUtils.logError(`Could not send DM after creating bounty from template ${template._id}`, e);
						} else {
							LogUtils.logError(`Could not create bounty from template ${template._id}`, e);
							continue;
						}
					}

					// Delete the most recent repeat if not claimed
					if (lastChild.status == BountyStatus.open) {
						const deleteRequest = new DeleteRequest({
							commandContext: null,
							messageReactionRequest: null,
							directRequest: {
								bountyId: lastChild._id,
								guildId: lastChild.customerId,
								userId: client.user.id,
								activity: Activities.delete,
								resolutionNote: 'Unclaimed repeat bounty',
								silent: true,
								bot: client.user.bot
							},
							buttonInteraction: null
						});
						try {
							await deleteBounty(deleteRequest);
						} catch (e) {
							if (e instanceof DMPermissionError) {
								LogUtils.logError(`Could not send DM after deleting unclaimed bounty ${lastChild._id}`, e);
							} else {

								LogUtils.logError(`Could not delete unclaimed bounty ${lastChild._id}`, e);
							}
						}
					}
				}
			} catch (e) {
				LogUtils.logError(`Could not create bounty from template ${template._id}`, e);
			}
		}
	}

	// Refresh the lists for each customer
	for (const [customerId, request] of customersAddedTo.entries()) {
		DiscordUtils.refreshLastList(customerId, request);
	}
}