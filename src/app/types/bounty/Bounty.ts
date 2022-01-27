import { Double, Int32, ObjectId } from 'mongodb';

// TODO - *TWE I don't think we need both this and BountyCollection. Settle on one or the other
export interface Bounty {
	_id?: ObjectId,
	season?: string,
	title: string,
	description: string,
	criteria: string,
	reward: Reward,
	createdBy?: UserObject,
	claimedBy?: UserObject,
	submittedBy?: UserObject,
	reviewedBy?: UserObject,
	createdAt: string,
	dueAt: string,
	status?: string,
	statusHistory: Status[],
	discordMessageId?: string,
	creatorMessage?: MessageInfo,
	claimantMessage?: MessageInfo,
	customerId: string,
	gate?: string[],
	evergreen?: boolean,
	claimLimit?: Int32,
	isParent?: boolean,
	parentId?: string,
	childrenIds?: ObjectId[]
	assign?: string,
	assignedName?: string,
	requireApplication?: boolean,
	applicants?: Applicant[]
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