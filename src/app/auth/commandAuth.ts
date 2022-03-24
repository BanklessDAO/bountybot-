import mongo, { Cursor, Db } from 'mongodb';
import MongoDbUtils from '../utils/MongoDbUtils';
import { CustomerCollection } from '../types/bounty/CustomerCollection';
import { BountyCollection } from '../types/bounty/BountyCollection';
import AuthorizationError from '../errors/AuthorizationError';
import DiscordUtils from '../utils/DiscordUtils';
import { Activities } from '../constants/activities';
import { PublishRequest } from '../requests/PublishRequest';
import { CreateRequest } from '../requests/CreateRequest';
import { ApplyRequest } from '../requests/ApplyRequest';
import { AssignRequest } from '../requests/AssignRequest';
import Log from '../utils/Log';
import { SubmitRequest } from '../requests/SubmitRequest';
import { ClaimRequest } from '../requests/ClaimRequest';
import { CompleteRequest } from '../requests/CompleteRequest';
import { Request } from '../requests/Request';
import { BountyStatus } from '../constants/bountyStatus';
import { HelpRequest } from '../requests/HelpRequest';
import { DeleteRequest } from '../requests/DeleteRequest';
import { PaidRequest } from '../requests/PaidRequest';
import { TagRequest } from '../requests/TagRequest';

const AuthorizationModule = {
    /**
     * Routes requests to the correct authorization checks.
     * Note: Authentication is handled natively by discord.
     * @param request 
     * @returns an empty Promise for upstream error handling and async calls
     * @throws AuthorizationError
     */
    async run(request: any): Promise<void> {
        Log.debug('Reached Authorization Handler')
        if ((request as Request).bot) {
            throw new AuthorizationError('Bots are unauthorized to work directly with bounties.')
        };

        switch ((request as Request).activity) {
            case Activities.create:
                return create(request as CreateRequest);
            case Activities.publish:
                return publish(request as PublishRequest);
            case Activities.claim:
                return claim(request as ClaimRequest);
            case Activities.apply:
                return apply(request as ApplyRequest);
            case Activities.assign:
                return assign(request as AssignRequest);
            case Activities.submit:
                return submit(request as SubmitRequest);
            case Activities.paid:
                return paid(request as PaidRequest);
            case Activities.complete:
                return complete(request as CompleteRequest);
            case Activities.list:
                return;
            case Activities.delete:
                return deleteAuthorization(request as DeleteRequest);
            case Activities.help:
                return help(request as HelpRequest);
            case Activities.registerWallet:
                return;
            case Activities.tag:
                return tag(request as TagRequest)
			case 'gm':
                return;
        }
    },
};

const create = async (request: CreateRequest): Promise<void> => {
    const db: Db = await MongoDbUtils.connect('bountyboard');
	const dbCustomers = db.collection('customers');

	const customerResult: CustomerCollection = await dbCustomers.findOne({
		customerId: request.guildId
	});

    if (! (await DiscordUtils.hasAllowListedRole(request.userId, request.guildId, customerResult.allowlistedRoles))) {
        throw new AuthorizationError(`Thank you for giving bounty commands a try!\n` +
                                `It looks like you don't have permission to use this command.\n` +
                                `If you think this is an error, please reach out to a server admin for help.`);
    }
}

const publish = async (request: PublishRequest): Promise<void> => {
    const db: Db = await MongoDbUtils.connect('bountyboard');
    const bountyCollection = db.collection('bounties');
    const dbBountyResult: BountyCollection = await bountyCollection.findOne({
        _id: new mongo.ObjectId(request.bountyId),
    });

    if (request.userId !== dbBountyResult.createdBy.discordId) {
        throw new AuthorizationError(
            `Thank you for giving bounty commands a try!\n` +
            `It looks like you don't have permission to ${request.activity} this bounty.\n` +
            `If you think this is an error, please reach out to a server admin for help.`
            );
    }
}

 const claim = async (request: ClaimRequest): Promise<void> => {
    const db: Db = await MongoDbUtils.connect('bountyboard');
    const bountyCollection = db.collection('bounties');
    const dbBountyResult: BountyCollection = await bountyCollection.findOne({
        _id: new mongo.ObjectId(request.bountyId),
    });

    if (dbBountyResult.gate && !(await DiscordUtils.hasAllowListedRole(request.userId, request.guildId, dbBountyResult.gate))) {
        throw new AuthorizationError(
            `Thank you for giving bounty commands a try!\n` +
            `It looks like you don't have permission to ${request.activity} this bounty.\n` +
            `The creator of this bounty gated it to specific role holders. Check the "for-role" value of the bounty to see which role you would need to claim it.`
        );
    }

    // If this is evergreen, see if this user already claimed an instance
    if (dbBountyResult.evergreen && dbBountyResult.childrenIds) {
        const childBounties: Cursor = bountyCollection.find({ _id: { $in: dbBountyResult.childrenIds } });
        let claimedBefore = false;
        let childBounty: BountyCollection;
        while (!claimedBefore && await childBounties.hasNext()) {
            childBounty = await childBounties.next();
            if (childBounty.claimedBy.discordId == request.userId) {
                claimedBefore = true;
            }
        }
        if (claimedBefore) {
            throw new AuthorizationError(
                `Thank you for giving bounty commands a try!\n` +
                `It looks like you have already claimed this bounty: ${process.env.BOUNTY_BOARD_URL + childBounty._id}`
            );
        }
    }

    if (dbBountyResult.requireApplication && (!dbBountyResult.assign || (request.userId !== dbBountyResult.assign))) {
        throw new AuthorizationError(
            `Thank you for giving bounty commands a try!\n` +
            'This bounty requires you to apply for it first, and the bounty creator\n' + 
            'must then assign it to you before you can claim it.'
        )
    }
    
    if (dbBountyResult.assign && (request.userId !== dbBountyResult.assign)) {
        throw new AuthorizationError(
            `Thank you for giving bounty commands a try!\n` +
            `It looks like you don't have permission to ${request.activity} this bounty.\n` +
            `The creator of this bounty has assigned it to another user.`
        )
    }
 }

const submit = async (request: SubmitRequest): Promise<void> => {
    const db: Db = await MongoDbUtils.connect('bountyboard');
    const bountyCollection = db.collection('bounties');
    const dbBountyResult: BountyCollection = await bountyCollection.findOne({
        _id: new mongo.ObjectId(request.bountyId),
    });

    if (request.userId !== dbBountyResult.claimedBy.discordId) {
        throw new AuthorizationError(
            `Thank you for giving bounty commands a try!\n` +
            `It looks like you don't have permission to ${request.activity} this bounty.\n` +
            `This bounty has already been claimed by <@${dbBountyResult.claimedBy.discordId}>. ` +
            `At this time, you can only submit bounties that you have previously claimed.\n` +
            `Please reach out to your favorite bounty board representative with any questions!` 
            );
    }
}

const apply = async (request: ApplyRequest): Promise<void> => {
    const db: Db = await MongoDbUtils.connect('bountyboard');
    const bountyCollection = db.collection('bounties');
    const dbBountyResult: BountyCollection = await bountyCollection.findOne({
        _id: new mongo.ObjectId(request.bountyId),
    });
    if (dbBountyResult.applicants && dbBountyResult.applicants.some(applicant => applicant.discordId == request.userId)) {
        throw new AuthorizationError(
            `Thank you for giving bounty commands a try!\n` +
            `It looks like you have already applied for this bounty.\n` +
            `Please reach out to your favorite bounty board representative with any questions!` 
        );
    }
}

const assign = async (request: AssignRequest): Promise<void> => {
    const db: Db = await MongoDbUtils.connect('bountyboard');
    const bountyCollection = db.collection('bounties');
    const dbBountyResult: BountyCollection = await bountyCollection.findOne({
        _id: new mongo.ObjectId(request.bountyId),
    });
    if (request.userId !== dbBountyResult.createdBy.discordId) {
        throw new AuthorizationError(
            `Thank you for giving bounty commands a try!\n` +
            `It looks like you don't have permission to ${request.activity} this bounty.\n` +
            `This bounty can only be assigned by <@${dbBountyResult.createdBy.discordId}>.\n ` +
            `Please reach out to your favorite bounty board representative with any questions!` 
            );
    }
}

const paid = async (request: PaidRequest): Promise<void> => {
    const db: Db = await MongoDbUtils.connect('bountyboard');
    const bountyCollection = db.collection('bounties');
    const dbBountyResult: BountyCollection = await bountyCollection.findOne({
        _id: new mongo.ObjectId(request.bountyId),
    });
    if (request.userId !== dbBountyResult.createdBy.discordId) {
        throw new AuthorizationError(
            `Thank you for giving bounty commands a try!\n` +
            `It looks like you don't have permission to mark this IOU as paid.\n` +
            `This IOU can only be paid by <@${dbBountyResult.createdBy.discordId}>.\n ` +
            `Please reach out to your favorite bounty board representative with any questions!` 
            );
    }
}

const complete = async (request: CompleteRequest): Promise<void> => {
    const db: Db = await MongoDbUtils.connect('bountyboard');
    const bountyCollection = db.collection('bounties');
    const dbBountyResult: BountyCollection = await bountyCollection.findOne({
        _id: new mongo.ObjectId(request.bountyId),
    });

    if (request.userId !== dbBountyResult.createdBy.discordId) {
        throw new AuthorizationError(
            `Thank you for giving bounty commands a try!\n` +
            `It looks like you don't have permission to ${request.activity} this bounty.\n` +
            `This bounty can only be completed by <@${dbBountyResult.createdBy.discordId}>. \n` +
            `At this time, you can only complete bounties that you have created.\n` +
            `Please reach out to your favorite bounty board representative with any questions!` 
            );
    }
}

const deleteAuthorization = async (request: DeleteRequest): Promise<void> => {
    const db: Db = await MongoDbUtils.connect('bountyboard');
    const bountyCollection = db.collection('bounties');
    const dbBountyResult: BountyCollection = await bountyCollection.findOne({
        _id: new mongo.ObjectId(request.bountyId),
    });

    if (request.userId !== dbBountyResult.createdBy.discordId) {
        throw new AuthorizationError(
            `Thank you for giving bounty commands a try!\n` +
            `It looks like you don't have permission to ${request.activity} this bounty.\n` +
            `This bounty can only be deleted by <@${dbBountyResult.createdBy.discordId}>. ` +
            `At this time, you can only delete bounties that you have created.\n` +
            `Please reach out to your favorite bounty board representative with any questions!` 
            );
    }
}

const help = async (request: HelpRequest): Promise<void> => {
    if (request.bountyId) {
        const db: Db = await MongoDbUtils.connect('bountyboard');
        const bountyCollection = db.collection('bounties');
        const dbBountyResult: BountyCollection = await bountyCollection.findOne({
            _id: new mongo.ObjectId(request.bountyId),
        });

        if (! (dbBountyResult.status === BountyStatus.open || request.userId === dbBountyResult.claimedBy.discordId)) {
            throw new AuthorizationError(
                `Thank you for giving bounty commands a try!\n` +
                `It looks like you don't have permission to request ${request.activity} for this bounty.\n` +
                `Please reach out to your favorite bounty board representative with any questions!` 
                );
        }
    }
}

const tag = async (request: TagRequest): Promise<void> => {
    const db: Db = await MongoDbUtils.connect('bountyboard');
    const bountyCollection = db.collection('bounties');
    const dbBountyResult: BountyCollection = await bountyCollection.findOne({
        _id: new mongo.ObjectId(request.bountyId),
    });

    if (request.userId !== dbBountyResult.createdBy.discordId) {
        throw new AuthorizationError(
            `Thank you for giving bounty commands a try!\n` +
            `It looks like you don't have permission to ${request.activity} this bounty.\n` +
            `This bounty can only be tagged by <@${dbBountyResult.createdBy.discordId}>. \n` +
            `At this time, you can only tag bounties that you have created.\n` +
            `Please reach out to your favorite bounty board representative with any questions!` 
            );
    }
}

export default AuthorizationModule;