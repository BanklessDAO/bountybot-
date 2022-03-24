import ValidationError from '../errors/ValidationError';
import BountyUtils from '../utils/BountyUtils';
import WalletUtils from '../utils/WalletUtils';
import Log, { LogUtils } from '../utils/Log';
import mongo, { Db } from 'mongodb';
import MongoDbUtils from '../utils/MongoDbUtils';
import { BountyCollection } from '../types/bounty/BountyCollection';
import { Activities } from '../constants/activities';
import { ListRequest } from '../requests/ListRequest';
import { PublishRequest } from '../requests/PublishRequest';
import { CreateRequest } from '../requests/CreateRequest';
import { ApplyRequest } from '../requests/ApplyRequest';
import { AssignRequest } from '../requests/AssignRequest';
import { SubmitRequest } from '../requests/SubmitRequest';
import { BountyStatus } from '../constants/bountyStatus';
import { ClaimRequest } from '../requests/ClaimRequest';
import { CompleteRequest } from '../requests/CompleteRequest';
import { PaidRequest } from '../requests/PaidRequest';
import { HelpRequest } from '../requests/HelpRequest';
import { DeleteRequest } from '../requests/DeleteRequest';
import { UpsertUserWalletRequest } from '../requests/UpsertUserWalletRequest';
import { TagRequest } from '../requests/TagRequest';


const ValidationModule = {
    /**
     * 
     * @param request 
     * @returns empty Promise for error handling or async calls
     */
    async run(request: any): Promise<void> {
        Log.debug(`Reached Validation Handler. Entering activity ${request.activity}`);
        switch (request.activity) {
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
                return list(request as ListRequest);
            case Activities.delete:
                return deleteValidation(request as DeleteRequest);
            case Activities.help:
                return help(request as HelpRequest);
            case Activities.registerWallet:
                return registerWallet(request as UpsertUserWalletRequest);
            case Activities.tag:
                return tag(request as TagRequest);
            case 'gm':
                return;
            default:
                throw new ValidationError(`Command not recognized. Please try again.`);
        }
    },
};

export default ValidationModule;

const create = async (request: CreateRequest): Promise<void> => {
    Log.debug(`Validating activity ${request.activity}`);
    BountyUtils.validateTitle(request.title);

    BountyUtils.validateReward(request.reward);

    BountyUtils.validateEvergreen(request.evergreen, request.claimLimit, !!(request.assign || request.gate));

    BountyUtils.validateRequireApplications(request);

    if (request.gate && request.assign) {
        throw new ValidationError(
            `Thank you for giving bounties a try!\n` +
            `Please select either for-user or for-role, but not both.`
        );
    }

    if (request.gate) {
        await BountyUtils.validateGate(request.gate, request.guildId);
    }

    if (request.assign) {
        await BountyUtils.validateAssign(request.assign, request.guildId, null)
    }
}

const paid = async (request: PaidRequest): Promise<void> => {
    Log.debug(`Validating activity ${request.activity}`);
    BountyUtils.validateBountyId(request.bountyId);

    const db: Db = await MongoDbUtils.connect('bountyboard');
    const dbCollectionBounties = db.collection('bounties');
    const dbBountyResult: BountyCollection = await dbCollectionBounties.findOne({
        _id: new mongo.ObjectId(request.bountyId),
        isIOU: true,
    });

    if (!dbBountyResult) {
        throw new ValidationError(
            `Please select a valid IOU id to mark paid. `
        );
    }

    if (dbBountyResult.status && dbBountyResult.status !== BountyStatus.open) {
        throw new ValidationError(
            `The IOU id you have selected is in status ${dbBountyResult.status}\n` +
            `Currently, only IOUs with status ${BountyStatus.open} can be mark paid.\n` +
            `Please reach out to your favorite Bounty Board representative with any questions!`
            );
    }
}

const publish = async (request: PublishRequest): Promise<void> => {
    Log.debug(`Validating activity ${request.activity}`);

    BountyUtils.validateBountyId(request.bountyId);

    const db: Db = await MongoDbUtils.connect('bountyboard');
    const dbCollectionBounties = db.collection('bounties');
    const dbBountyResult: BountyCollection = await dbCollectionBounties.findOne({
        _id: new mongo.ObjectId(request.bountyId),
        isIOU: { $ne: true },
    });

    if (!dbBountyResult) {
        throw new ValidationError(
            `Please select a valid bounty id to ${request.activity}. ` +
            `Check your previous DMs from bountybot for the correct id.`
        );
    }

    if (!request.clientSyncRequest && dbBountyResult.status && dbBountyResult.status !== BountyStatus.draft) {
        throw new ValidationError(
            `The bounty id you have selected is in status ${dbBountyResult.status}\n` +
            `Currently, only bounties with status draft can be published to the bounty channel.\n` +
            `Please reach out to your favorite Bounty Board representative with any questions!`
            );
    }
}

const apply = async (request: ApplyRequest): Promise<void> => {
    Log.debug(`Validating activity ${request.activity}`);
    BountyUtils.validateBountyId(request.bountyId);

    const db: Db = await MongoDbUtils.connect('bountyboard');
    const dbCollectionBounties = db.collection('bounties');
    const dbBountyResult: BountyCollection = await dbCollectionBounties.findOne({
        _id: new mongo.ObjectId(request.bountyId),
        isIOU: { $ne: true },
    });

    if (!dbBountyResult) {
        throw new ValidationError(
            `Please select a valid bounty id to ${request.activity} for. `
        );
    }

    if (!dbBountyResult.requireApplication) {
        throw new ValidationError(
            `The bounty id you have selected does not require application.\n` +
            `You can claim the bounty directly.\n` +
            `Please reach out to your favorite Bounty Board representative with any questions!`
            );
    }

    if (dbBountyResult.status && dbBountyResult.status !== BountyStatus.open) {
        throw new ValidationError(
            `The bounty id you have selected is in status ${dbBountyResult.status}\n` +
            `Currently, only bounties with status ${BountyStatus.open} can be applied for.\n` +
            `Please reach out to your favorite Bounty Board representative with any questions!`
            );
    }

}

const assign = async (request: AssignRequest): Promise<void> => {
    Log.debug(`Validating activity ${request.activity}`);
    BountyUtils.validateBountyId(request.bountyId);

    const db: Db = await MongoDbUtils.connect('bountyboard');
    const dbCollectionBounties = db.collection('bounties');
    const dbBountyResult: BountyCollection = await dbCollectionBounties.findOne({
        _id: new mongo.ObjectId(request.bountyId),
        isIOU: { $ne: true },
    });

    if (!dbBountyResult) {
        throw new ValidationError(
            `Please select a valid bounty id to ${request.activity}. `
        );
    }

    if (!dbBountyResult.requireApplication) {
        throw new ValidationError(
            `This bounty did not require applications, so it is not assignable.\n` +
            `If you would like to assign a bounty without requiring applications, ` +
            `please use /bounty create with the 'assign-to' option.`
        );
    }

    if (dbBountyResult.status && dbBountyResult.status !== BountyStatus.open) {
        throw new ValidationError(
            `The bounty id you have selected is in status ${dbBountyResult.status}\n` +
            `Currently, only bounties with status ${BountyStatus.open} can be assigned.\n` +
            `Please reach out to your favorite Bounty Board representative with any questions!`
            );
    }

    if (!request.assign) {
        throw new ValidationError(
            `Please speficy the user to assign this bounty to.`
        );
    }

    if (!dbBountyResult.applicants) {
        throw new ValidationError(
            `No users have applied for this bounty yet.\n` +
            `If you'd like to assign this bounty to <@${request.assign}>, ` +
            `please ask them to apply for this bounty in the bounty channel with 🙋 or with /bounty apply.`
        );
    }

    await BountyUtils.validateAssign(request.assign, request.guildId, dbBountyResult.applicants)

}

const claim = async (request: ClaimRequest): Promise<void> => {
    Log.debug(`Validating activity ${request.activity}`);
    BountyUtils.validateBountyId(request.bountyId);

    const db: Db = await MongoDbUtils.connect('bountyboard');
    const dbCollectionBounties = db.collection('bounties');
    const dbBountyResult: BountyCollection = await dbCollectionBounties.findOne({
        _id: new mongo.ObjectId(request.bountyId),
        isIOU: { $ne: true },
    });

    if (!dbBountyResult) {
        throw new ValidationError(
            `Please select a valid bounty id to ${request.activity}. `
        );
    }

    if (request.clientSyncRequest && dbBountyResult.evergreen) {
        throw new ValidationError(
            `🚧 🚧 🚧 \n` + 
            `Reflecting claims for a multi-claimant bounty in the front end is in development.` +
            `Please reach out to your favorite Bounty Board representative with any questions!` +
            `🚧 🚧 🚧 \n`
            );
    }

    if (!request.clientSyncRequest && dbBountyResult.status && dbBountyResult.status !== BountyStatus.open) {
        throw new ValidationError(
            `The bounty id you have selected is in status ${dbBountyResult.status}\n` +
            `Currently, only bounties with status ${BountyStatus.open} can be claimed.\n` +
            `Please reach out to your favorite Bounty Board representative with any questions!`
            );
    }
}

const submit = async (request: SubmitRequest): Promise<void> => {
    Log.debug(`Validating activity ${request.activity}`);
    BountyUtils.validateBountyId(request.bountyId);

    if (request.url) {
        BountyUtils.validateUrl(request.url);
    }

    if (request.notes) {
        BountyUtils.validateNotes(request.notes);
    }

    const db: Db = await MongoDbUtils.connect('bountyboard');
    const bountyCollection = db.collection('bounties');
    const dbBountyResult: BountyCollection = await bountyCollection.findOne({
        _id: new mongo.ObjectId(request.bountyId),
        isIOU: { $ne: true },
    });

    if (!dbBountyResult) {
        throw new ValidationError(`Please select a valid bounty id to ${request.activity}. ` +
            'Check your previous DMs from bountybot for the correct id.')
    }

    if (dbBountyResult.status && dbBountyResult.status !== BountyStatus.in_progress) {
        throw new ValidationError(`The bounty id you have selected is in status ${dbBountyResult.status}\n` +
            `Currently, only bounties with status ${BountyStatus.in_progress} can be submitted for review.\n` +
            `Please reach out to your favorite Bounty Board representative with any questions!`)
    }
}

const complete = async (request: CompleteRequest): Promise<void> => {
    Log.debug(`Validating activity ${request.activity}`);
    BountyUtils.validateBountyId(request.bountyId);

    const db: Db = await MongoDbUtils.connect('bountyboard');
    const bountyCollection = db.collection('bounties');
    const dbBountyResult: BountyCollection = await bountyCollection.findOne({
        _id: new mongo.ObjectId(request.bountyId),
        isIOU: { $ne: true },
    });

    if (!dbBountyResult) {
        throw new ValidationError(`Please select a valid bounty id to ${request.activity}. ` +
            'Check your previous DMs from bountybot for the correct id.')
    }

    const inReview = dbBountyResult.status && dbBountyResult.status === BountyStatus.in_review;
    const inProgress = dbBountyResult.status && dbBountyResult.status === BountyStatus.in_progress;

    if (dbBountyResult.status && !(inProgress || inReview)) {
        throw new ValidationError(`The bounty id you have selected is in status ${dbBountyResult.status}\n` +
            `Currently, only bounties with status ${BountyStatus.in_review} can be marked for completion.\n` +
            `Please reach out to your favorite Bounty Board representative with any questions!`)
    }
}

const list = async (request: ListRequest): Promise<void> => {
    Log.debug(`Validating activity ${request.activity}`);
    switch (request.listType) {
        case 'CREATED_BY_ME':
            return;
        case 'CLAIMED_BY_ME':
            return;
        case 'CLAIMED_BY_ME_AND_COMPLETE':
            return;
        case 'DRAFTED_BY_ME':
            return;
        case 'OPEN':
            return;
        case 'IN_PROGRESS':
            return;
        case 'PAID_BY_ME':
            return;
        case 'UNPAID_BY_ME':
            return;
        default:
            Log.info('invalid list-type');
            throw new ValidationError('Please select a valid list-type from the command menu');
    }
}

const deleteValidation = async (request: DeleteRequest): Promise<void> => {
    Log.debug(`Validating activity ${request.activity}`);
    BountyUtils.validateBountyId(request.bountyId);

    const db: Db = await MongoDbUtils.connect('bountyboard');
    const dbCollectionBounties = db.collection('bounties');
    const dbBountyResult: BountyCollection = await dbCollectionBounties.findOne({
        _id: new mongo.ObjectId(request.bountyId),
    });

    if (!dbBountyResult) {
        throw new ValidationError(
            `Please select a valid bounty id to ${request.activity}. ` +
            `Check your previous DMs from bountybot for the correct id.`
        );
    }

    const currentDate: string = (new Date()).toISOString();

    const invalidBountyStatus = 
        dbBountyResult.status && 
        !(dbBountyResult.status === BountyStatus.draft ||
        dbBountyResult.status === BountyStatus.open ||
            (dbBountyResult.status === BountyStatus.in_progress && 
                !BountyUtils.isWithin24Hours(currentDate, BountyUtils.getClaimedAt(dbBountyResult))));

    if (invalidBountyStatus) {
        throw new ValidationError(
            `The bounty id you have selected is in status ${dbBountyResult.status}\n` +
            `Currently, only bounties with status ${BountyStatus.draft} and ${BountyStatus.open} can be deleted.\n` +
            `Please reach out to your favorite Bounty Board representative with any questions!`
            );
    }
}

const help = async (request: HelpRequest): Promise<void> => {
    Log.debug(`Validating activity ${request.activity}`);
    if (request.bountyId) {
        BountyUtils.validateBountyId(request.bountyId);

        const db: Db = await MongoDbUtils.connect('bountyboard');
        const bountyCollection = db.collection('bounties');
        const dbBountyResult: BountyCollection = await bountyCollection.findOne({
            _id: new mongo.ObjectId(request.bountyId),
        });

        if (!dbBountyResult) {
            throw new ValidationError(`Please select a valid bounty id to request ${request.activity}. ` +
                'Check your previous DMs from bountybot for the correct id.')
        }
    }
}

const registerWallet = async (request: UpsertUserWalletRequest): Promise<void> => {
    Log.debug(`Validating activity ${request.activity}`);

    if (request.address) {
        WalletUtils.validateEthereumWalletAddress(request.address)
    }
}

const tag = async (request: TagRequest): Promise<void> => {
    Log.debug(`Validating activity ${request.activity}`);

    BountyUtils.validateBountyId(request.bountyId);

    const db: Db = await MongoDbUtils.connect('bountyboard');
    const dbCollectionBounties = db.collection('bounties');
    const dbBountyResult: BountyCollection = await dbCollectionBounties.findOne({
        _id: new mongo.ObjectId(request.bountyId),
    });

    if (!dbBountyResult) {
        throw new ValidationError(
            `Please select a valid bounty id to ${request.activity}. ` +
            `Check your previous DMs from bountybot for the correct id.`
        );
    }

    if (request.tag) {
        BountyUtils.validateTag(request.tag);
    }
}
