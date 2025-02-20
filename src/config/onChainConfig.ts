import { ethers } from 'ethers';
import { cleanEnv, str, url } from 'envalid';
import logger from '../utils/logger';
// import abi from './abi.json'; // Ensure you have your contract's ABI in this path

const env = cleanEnv(process.env, {
	PRIVATE_KEY: str(),
	ARBITRUM_RPC_URL: url(),
});

const provider = new ethers.JsonRpcProvider(env.ARBITRUM_RPC_URL);
const wallet = new ethers.Wallet(env.PRIVATE_KEY, provider);

export default {
	provider,
	wallet,
	// abi,
	getWallet: () => wallet,
};
