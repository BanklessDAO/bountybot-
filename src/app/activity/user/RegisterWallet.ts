import { Db, UpdateWriteOpResult } from "mongodb";
import { UpsertUserWalletRequest } from "../../requests/UpsertUserWalletRequest";
import { UserCollection } from "../../types/user/UserCollection";
import MongoDbUtils from "../../utils/MongoDbUtils";
import Log from "../../utils/Log";
import BountyUtils from "../../utils/BountyUtils";
import DiscordUtils from "../../utils/DiscordUtils";
import { ButtonInteraction, ModalOptions, ModalSubmitInteraction } from "discord.js";
import { ComponentType, TextInputStyle, ModalInteractionContext, ModalOptions as scModalOptions, CommandContext } from "slash-create";
import RuntimeError from "../../errors/RuntimeError";
import ValidationError from "../../errors/ValidationError";
import WalletUtils, { ADDRESS_DELETE_REGEX } from "../../utils/WalletUtils";

export const upsertUserWallet = async (request: UpsertUserWalletRequest): Promise<any> => {

    // If an address came with the request, it was already validated, just store it and respond.
    if (request.address) {
        await dbHandler(request);
        await finishRegister(request);
        return;
    }
    
    // Different modal data types and calls in slash commands vs. button interactions
    const fromSlash = !!request.commandContext;
    console.log(`fromSlash ${fromSlash}`);
    console.log(`commandContext ${request.commandContext}`);
    const current_address = await BountyUtils.userWalletRegistered(request.userDiscordId);
    console.log(`Current address ${current_address}`);

    const modal = {
        title: 'Wallet Address',
        components: [
        {
            type: (fromSlash ? ComponentType.ACTION_ROW : "ACTION_ROW"),
            components: [
            {
                type: (fromSlash ? ComponentType.TEXT_INPUT : "TEXT_INPUT"),
                label: 'Wallet Address or \'DELETE\' to remove existing',
                style: (fromSlash ? TextInputStyle.PARAGRAPH: "PARAGRAPH"),
                required: true,
                max_length: 100,
                custom_id: 'wallet_address',
                placeholder: 'Enter your wallet address so you can be paid.',
                value: current_address ? current_address : ""
            }]
        }]
    };

    // Check what we got in the modal, and if good store and respond
    const walletRegister = async (request: UpsertUserWalletRequest, context: ModalInteractionContext | ModalSubmitInteraction) => {

        try {
            WalletUtils.validateEthereumWalletAddress(request.address);
        } catch (e) {
            if (e instanceof ValidationError) {
                if (context instanceof ModalInteractionContext) {
                    console.log("Reply 5: context.send");
                    await context.send(e.message);
                } else {
                    console.log("Reply 6: context.reply");
                    await context.reply({content: e.message, ephemeral: true});
                }
                return;
            } 
            throw new RuntimeError(e);               
        }

        // We have a new context to use after the modal for the response
        if (context instanceof ModalInteractionContext) {
            request.commandContext = context as unknown as CommandContext;
        } else {
            request.buttonInteraction = context as unknown as ButtonInteraction;
        }
        
        await dbHandler(request);
        await finishRegister(request);

/*         if (context instanceof ModalInteractionContext) {
            console.log("Reply 7: context.send");
            await context.send('Wallet address updated');
        } else {
            try {
                console.log("Reply 8: context.user.send");
                await context.user.send('Wallet address updated');
            } catch (e) {
                Log.debug(`Couldn't sent wallet confirm to @<${context.user}>`);
            }
        }
 */
        // We were called from another activity. Restore the original request object except for the context, and call back into that activity
        if (request.callBack) {
            console.log("Restoring request, but keeping new context from modal so replies work");
            request.origRequest.commandContext = request.commandContext;
            request.origRequest.buttonInteraction = request.buttonInteraction;
            console.log("Doing callback");
            await request.callBack(request.origRequest);
            return;
        }


        return;

    }

    // Callback for the slash modal version
    const modalCallback = async (modalContext: ModalInteractionContext, request: UpsertUserWalletRequest) => {
        console.log("In modalCallback");
        await modalContext.defer(true);
        request.address = modalContext.values.wallet_address;
        await walletRegister(request, modalContext);
    };

    // Call the modal. For slash command (slacsh-create), call the callback. For button interaction (discord.js), wait for submit and return. 

    if (fromSlash) {
        try {
            await request.commandContext.sendModal(modal as unknown as scModalOptions,async (mctx) => { await modalCallback(mctx, request) });
        } catch(e) {
            Log.error(e.message);
            throw new RuntimeError(e);
        }
        return;
    } else {
        try {
            await request.buttonInteraction.showModal(Object.assign(modal, {customId: 'wallet_address'}) as unknown as ModalOptions);
        } catch(e) {
            Log.error(e.message);
            throw new RuntimeError(e);
        }
        console.log("After showModal");
        const submittedInteraction = await request.buttonInteraction.awaitModalSubmit({
            time: 60000,
            filter: i => i.user.id === request.userDiscordId,
            }).catch(e => {
                Log.error(e.message);
                // TODO Catch timeout error here
                throw new RuntimeError(e);
            });
        request.address = submittedInteraction.components[0].components[0].value;
        await walletRegister(request, submittedInteraction);
    }
    
}

export const finishRegister = async (request: UpsertUserWalletRequest) => {
    console.log("In finishRegister");
    if (ADDRESS_DELETE_REGEX.test(request.address)) {
        console.log("Reply 9: activityResponse");
        await DiscordUtils.activityResponse(request.commandContext, request.buttonInteraction, "Your wallet address has been deleted.");
      
    } else {
        const activityMessage = `<@${request.userDiscordId}>, your wallet address has been registered as ${request.address}.\n`+
                                `You can change it by using the /register-wallet command.`;
        const etherscanUrl = `https://etherscan.io/address/${request.address}`;
        console.log("Reply 10: activityResponse");
        await DiscordUtils.activityResponse(request.commandContext, request.buttonInteraction, activityMessage, etherscanUrl, "View on Etherscan");
    }
}

const dbHandler = async (request: UpsertUserWalletRequest): Promise<void> => {
    console.log("In dbHandler");
    const db: Db = await MongoDbUtils.connect('bountyboard');
    const userCollection = db.collection('user');

	const dbUserResult: UserCollection = await userCollection.findOne({
		userDiscordId: request.userDiscordId,
	});

    if (!dbUserResult) {
        await userCollection.insertOne({
            userDiscordId: request.userDiscordId,
        })
    }

	const writeResult: UpdateWriteOpResult = await userCollection.updateOne({userDiscordId: request.userDiscordId}, 
        ADDRESS_DELETE_REGEX.test(request.address) ? 
        {
            $unset: {
                walletAddress: "",
            },
        } :
        {
            $set: {
                walletAddress: request.address,
            },
        }
    );

    if (writeResult.result.ok !== 1) {
        Log.error(`Write result did not execute correctly`);
        throw new Error(`Write to database for user ${request.userDiscordId}: ${request.address} failed`);
    }
}