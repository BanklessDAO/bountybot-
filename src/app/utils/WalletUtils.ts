import ValidationError from "../errors/ValidationError";
const WalletUtils = {
    validateEthereumWalletAddress(address: string): void {
        const ETHEREUM_WALLET_REGEX = /^0x[a-fA-F0-9]{40}$/g;
        if (address == null || !ETHEREUM_WALLET_REGEX.test(address)) {
            throw new ValidationError(
                'Please enter a valid ethereum address\n');
        }
    } 
}

export default WalletUtils;