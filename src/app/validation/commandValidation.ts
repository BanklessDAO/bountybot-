import ValidationError from '../errors/ValidationError';
import BountyUtils from '../utils/BountyUtils';
import Log, { LogUtils } from '../utils/Log';
import mongo, { Db } from 'mongodb';
import MongoDbUtils from '../utils/MongoDbUtils';
import { BountyCollection } from '../types/bounty/BountyCollection';
import { Activities } from '../constants/activities';
import { ListRequest } from '../requests/ListRequest';
import { PublishRequest } from '../requests/PublishRequest';
import { CreateRequest } from '../requests/CreateRequest';
import { SubmitRequest } from '../requests/SubmitRequest';
import { BountyStatus } from '../constants/bountyStatus';
import { TextChannel } from 'discord.js';
import DiscordUtils from '../utils/DiscordUtils';
import { CustomerCollection } from '../types/bounty/CustomerCollection';
import { ClaimRequest } from '../requests/ClaimRequest';
import { CompleteRequest } from '../requests/CompleteRequest';
import { HelpRequest } from '../requests/HelpRequest';
import { DeleteRequest } from '../requests/DeleteRequest';


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
            case Activities.submit:
                return submit(request as SubmitRequest);
            case Activities.complete:
                return complete(request as CompleteRequest);
            case Activities.list:
                return list(request as ListRequest);
            case Activities.delete:
                return deleteValidation(request as DeleteRequest);
            case Activities.help:
                return help(request as HelpRequest);
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

    if (request.copies) {
        BountyUtils.validateCopies(request.copies);
        throw new ValidationError(
            `The copies option is currently under construction.\n` +
            `Please create bounties without copies.\n` + 
            `If you have any questions or would like to use the copies feature, ` +
            `please reach out to your favorite Bounty Board representative`
        );
    }

    if (request.gate && request.assign) {
        throw new ValidationError(
            `Thank you for giving bounties a try!\n` +
            `Please select either assign-to or gate, but not both.`
        );
    }

    if (request.gate) {
        await BountyUtils.validateGate(request.gate, request.guildId);
    }

    if (request.assign) {
        await BountyUtils.validateAssign(request.assign, request.guildId)
    }
}

const publish = async (request: PublishRequest): Promise<void> => {
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

    if (dbBountyResult.status && dbBountyResult.status !== BountyStatus.draft) {
        throw new ValidationError(
            `The bounty id you have selected is in status ${dbBountyResult.status}\n` +
            `Currently, only bounties with status draft can be published to the bounty channel.\n` +
            `Please reach out to your favorite Bounty Board representative with any questions!`
            );
    }
}

const claim = async (request: ClaimRequest): Promise<void> => {
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

    if (dbBountyResult.status && dbBountyResult.status !== BountyStatus.open) {
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
    });

    if (!dbBountyResult) {
        throw new ValidationError(`Please select a valid bounty id to ${request.activity}. ` +
            'Check your previous DMs from bountybot for the correct id.')
    }

    if (dbBountyResult.status && dbBountyResult.status !== BountyStatus.in_review) {
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
