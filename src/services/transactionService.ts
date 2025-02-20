import { ethers } from 'ethers';
import logger from '../utils/logger';
import { supply_usdc } from './onChain/supply_usdc';
import { getBalance } from './onChain/getBalances';
import { TransactionParams } from '../types/TransactionTypes';
// Import other on-chain actions as you create them
import { withdraw_usdc } from './onChain/withdraw_usdc';
import { borrow_usdc } from './onChain/borrow_usdc';
import { repay_usdc } from './onChain/repay_usdc';
import { deposit_eth } from './onChain/deposit_eth';
import { withdraw_eth } from './onChain/withdraw_eth';
// import { repay, RepayParams } from './onChain/repay';

export const executeOnChainAction = async (params: TransactionParams) => {
	const { action, params: actionParams } = params;

	try {
		switch (action) {
			case 'supply_usdc':
				return await supply_usdc(actionParams.amount);
			case 'withdraw_usdc':
				return await withdraw_usdc(actionParams.amount);
			case 'borrow_usdc':
				return await borrow_usdc(actionParams.amount);
			case 'repay_usdc':
				return await repay_usdc(actionParams.amount);
			case 'deposit_eth':
				return await deposit_eth(actionParams.amount);
			case 'withdraw_eth':
				return await withdraw_eth(actionParams.amount);
			// case 'repay':
			//   return await repay(actionParams.amount);
			case 'getBalance':
				return await getBalance();
			default:
				throw new Error(`Unsupported action: ${action}`);
		}
	} catch (error: any) {
		logger.error(`Failed to execute on-chain action: ${action}`, {
			error: error.message,
			stack: error.stack,
		});
		throw error;
	}
};
