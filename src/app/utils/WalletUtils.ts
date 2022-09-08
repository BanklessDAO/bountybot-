import ValidationError from "../errors/ValidationError";

export const ETHEREUM_WALLET_REGEX = /^0x[a-fA-F0-9]{40}$/g;
export const ADDRESS_DELETE_REGEX = /^DELETE$/ig;

const WalletUtils = {
    validateEthereumWalletAddress(address: string): void {
        if (address == null || (!ETHEREUM_WALLET_REGEX.test(address) && !(ADDRESS_DELETE_REGEX.test(address)))) {
            throw new ValidationError(
                'Invalid Ethereum Address. Format is "0x" followed by 40 hex characters.\n');
        }
    } 
}

export default WalletUtils;