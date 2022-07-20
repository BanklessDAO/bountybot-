import { createBounty } from './Create'
import { publishBounty } from './Publish'
import { applyBounty } from './Apply'
import { assignBounty } from './Assign'
import { claimBounty } from './Claim'
import { submitBounty } from './Submit'
import { completeBounty } from './Complete'
import { paidBounty } from './Paid'
import { listBounty } from './List'
import { deleteBounty } from './Delete'
import { helpBounty } from './Help'
import { upsertUserWallet } from '../user/RegisterWallet';
import { tagBounty } from './Tag';


import Log from '../../utils/Log';

import { CreateRequest } from '../../requests/CreateRequest'
import { PublishRequest } from '../../requests/PublishRequest';
import { ClaimRequest } from '../../requests/ClaimRequest';
import { ApplyRequest } from '../../requests/ApplyRequest';
import { AssignRequest } from '../../requests/AssignRequest';
import { SubmitRequest } from '../../requests/SubmitRequest';
import { CompleteRequest } from '../../requests/CompleteRequest';
import { PaidRequest } from '../../requests/PaidRequest';
import { ListRequest } from '../../requests/ListRequest';
import { DeleteRequest } from '../../requests/DeleteRequest';
import { HelpRequest } from '../../requests/HelpRequest';
import { Activities } from '../../constants/activities';
import DiscordUtils from '../../utils/DiscordUtils';
import { GmRequest } from '../../requests/GmRequest'
import { UpsertUserWalletRequest } from '../../requests/UpsertUserWalletRequest'
import { TagRequest } from '../../requests/TagRequest'

export const BountyActivityHandler = {
    /**
     * BountyActivityHandler::run is responsible for routing activity requests to the correct activity function.
     * This function is not responsible for error handling or status messages to the user. 
     * @param request 
     * @returns an empty Promise for error handling and async calls
     */
    async run(request: any): Promise<void> {

        let command: Promise<any>;

        Log.debug('Reached Activity Handler')
        Log.debug(request.activity)
     

        // TODO in all activities, replace any use of request.commandContext with cherry picked fields 
        //      from the commandContext object as top level fields of the [Activity]Request class
        switch (request.activity) {
            case Activities.create:
                await createBounty(request as CreateRequest);
                break;
            case Activities.publish:
                await publishBounty(request as PublishRequest);
                break;
            case Activities.claim:
                await claimBounty(request as ClaimRequest);
                break;
            case Activities.apply:
                await applyBounty(request as ApplyRequest);
                break;
            case Activities.assign:
                await assignBounty(request as AssignRequest);
                break;
            case Activities.submit:
                await submitBounty(request as SubmitRequest);
                break;
            case Activities.complete:
                await completeBounty(request as CompleteRequest);
                break;
            case Activities.paid:
                await paidBounty(request as PaidRequest);
                break;
            case Activities.list:
                await listBounty(request as ListRequest);
                break;
            case Activities.delete:
                await deleteBounty(request as DeleteRequest);
                break;
            case Activities.help:
                await helpBounty(request as HelpRequest);
                break;
            case Activities.registerWallet:
                await upsertUserWallet(request as UpsertUserWalletRequest);
                break;
            case Activities.tag:
                await tagBounty(request as TagRequest);
                break;
            case 'gm':
                let gmRequest: GmRequest = request;
                Log.debug(`${gmRequest.guildId}, ${gmRequest.userId}`)
                const { guildMember } = await DiscordUtils.getGuildAndMember(gmRequest.guildId, gmRequest.userId);
                await request.commandContext.send({ content: `gm <@${guildMember.id}>!` })
                break;
        }
        return;
    },
}