import { Double, Int32, ObjectId } from 'mongodb';

// TODO - *TWE I don't think we need both this and BountyCollection. Settle on one or the other
// assign and assignedName are deprecated, replaced by assignTo
export interface Bounty {
	_id?: ObjectId,
	season?: string,
	title: string,
	description?: string,
	criteria?: string,
	reward: Reward,
	createdBy?: UserObject,
	claimedBy?: UserObject,
	submittedBy?: UserObject,
	reviewedBy?: UserObject,
	createdAt: string,
	createdInChannel?: string,
	dueAt?: string,
	status?: string,
	paidStatus?: string,
	statusHistory: Status[],
	discordMessageId?: string,
	creatorMessage?: MessageInfo,
	claimantMessage?: MessageInfo,
	submittedAt?: string,
	submissionUrl?: string,
	submissionNotes?: string,
	customerId: string,
	gate?: string[],
	gateTo?: RoleObject[],
	evergreen?: boolean,
	claimLimit?: Int32,
	isParent?: boolean,
	parentId?: string,
	childrenIds?: ObjectId[]
	assign?: string,
	assignedName?: string,
	assignTo?: UserObject,
	requireApplication?: boolean,
	applicants?: Applicant[],
	activityHistory: ClientInteraction[],
	isIOU?: boolean,
	resolutionNote?: string,
	owedTo?: UserObject
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
	iconUrl: string,
	pitch: string,
};

export type RoleObject = {
	discordId: string,
	discordName: string,
	iconUrl: string,
};

export type Reward = {
	currency: string,
	amount: Double,
	scale: Int32,
};

export type Status = {
	status: string,
	setAt: string,
};

export type ClientInteraction = {
	activity: string,
	modifiedAt: string,
	client: string
};