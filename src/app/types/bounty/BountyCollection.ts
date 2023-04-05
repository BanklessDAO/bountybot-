import { Collection, Double, Int32, ObjectId } from 'mongodb';

// assign and assignedName are deprecated, replaced by assignTo
// submissionUrl is deprecated
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
	createdInChannel: string,
	dueAt: string,
	submittedAt: string,
	submissionUrl: string,
	submissionNotes: string,
	status: string,
	paidStatus: string,
	statusHistory: Status[],
	discordMessageId: string,
	canonicalCard: MessageInfo,
	creatorMessage: MessageInfo,
	claimantMessage: MessageInfo,
	customerId: string,
	gate: string[],
	gateTo: RoleObject[],
	evergreen: boolean,
	claimLimit: Int32,
	isParent: boolean,
	parentId: ObjectId,
	childrenIds: ObjectId[],
	isRepeatTemplate: boolean,
	repeatTemplateId: string,
	repeatDays: Int32,
	numRepeats: Int32,
	endRepeatsDate: string,
	assign: string,
	assignedName: string,
	assignTo: UserObject,
	requireApplication: boolean,
	applicants: Applicant[],
	activityHistory: ClientInteraction[],
	isIOU: boolean,
	resolutionNote: string,
	tags: TagObject,
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
}

export type ClientInteraction = {
	activity: string,
	modifiedAt: string,
	client: string
};

export type TagObject = {
    channelCategory: string,
    keywords?: string[]
};

