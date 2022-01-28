import { Collection, Double, Int32, ObjectId } from 'mongodb';

export interface BountyCollection extends Collection {
	_id: ObjectId,
	season: string,
	title: string,
	description: string,
	criteria: string,
	reward: Reward,
	createdBy: UserObject,
	claimedBy: UserObject,
	submittedBy: UserObject,
	reviewedBy: UserObject,
	createdAt: string,
	dueAt: string,
	status: string,
	statusHistory: Status[],
	discordMessageId: string,
	creatorMessage: MessageInfo,
	claimantMessage: MessageInfo,
	customerId: string,
	gate: string[],
	evergreen: boolean,
	claimLimit: Int32,
	isParent: boolean,
	parentId: ObjectId,
	childrenIds: ObjectId[]
	assign: string,
	assignedName: string,
	requireApplication: boolean,
	applicants: Applicant[],
}

export type UserObject = {
	discordHandle: string,
	discordId: string,
	iconUrl: string,
};

export type MessageInfo = {
	messageId: string,
	channelId: string,
};

export type Applicant = {
	discordId: string,
	discordHandle: string,
	pitch: string,
}

export type Reward = {
	currency: string,
	amount: Double,
	scale: Int32,
};

export type Status = {
	status: string,
	setAt: string,
}