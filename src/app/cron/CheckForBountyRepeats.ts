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
		const template: BountyCollection = await bountyTemplates.next();
		const children: Cursor = bountyCollection.find({ 'repeatTemplateId': template._id }, { sort: { 'createdAt': -1 } });

		// If hit end of repeats, delete the template
		if (await areRepeatsDone(template, children)) {
			const deleteRequest = new DeleteRequest({
				commandContext: null,
				messageReactionRequest: null,
				directRequest: {
					bountyId: template._id,
					guildId: template.customerId,
					userId: client.user.id,
					activity: Activities.delete,
					resolutionNote: 'Repeats exhausted',
					silent: true,
					bot: client.user.bot
				},
				buttonInteraction: null
			});
			try {
				await deleteBounty(deleteRequest);
			} catch (e) {
				if (e instanceof DMPermissionError) {
					LogUtils.logError(`Could not send DM after deleting repeating bounty ${template._id}`, e);
				} else {

					LogUtils.logError(`Could not delete repeating bounty ${template._id}`, e);
				}
				continue;
			}
		} else {
			// See if we are repeat-days past the last child, and if so, create another.
			const lastChild = await children.next();
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
							}
							continue;
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
								continue;
							}
						}
					}
				} catch (e) {
					LogUtils.logError(`Could not create bounty from template ${template._id}`, e);
					continue;
				}
			}
		}
	}

	// Refresh the lists for each customer
	for (const [customerId, request] of customersAddedTo.entries()) {
		DiscordUtils.refreshLastList(customerId, request);
	}
}

export const areRepeatsDone = async (template: BountyCollection, children: Cursor): Promise<boolean> => {
	// Max repeats reached?
	if (template.numRepeats && (await children.count() >= template.numRepeats)) {
		return true;
	}

	// End date reached?
	if (template.endRepeatsDate) {
		try {
			console.log(`Checking date ${template.endRepeatsDate}`);
			const endDate = (new Date(template.endRepeatsDate)).setHours(0, 0, 0, 0);
			const now = (new Date()).setHours(0, 0, 0, 0);
			console.log(`against ${new Date(now).toISOString()}`);

			return now > endDate;
		} catch (e) {
			LogUtils.logError(`Could not evaluate template end date ${template._id}`, e);
		}
	}

	return false;

}