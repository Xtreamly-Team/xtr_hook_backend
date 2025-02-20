// src/routes/transactionRoutes.ts

import express, { Request, Response } from 'express';
import { executeOnChainAction } from '../services/transactionService';
import { TransactionParams, OnChainAction } from '../types/TransactionTypes';
import { validateTransaction } from '../middleware/validateTransaction';
import logger from '../utils/logger';

const router = express.Router();

/**
 * Define an interface for the request body to enhance type safety
 */
interface ExecuteTransactionRequest extends Request {
	body: {
		action: OnChainAction;
		data: string; // 'data' represents 'amount' for supply/withdraw/repay and 'account' for getBalance
	};
}

/**
 * @route POST /api/execute-transaction
 * @desc Executes a specified on-chain action
 * @access Public or Protected
 */
router.post(
	'/execute-transaction',
	validateTransaction,
	async (req: ExecuteTransactionRequest, res: Response) => {
		const { action, data } = req.body;

		logger.info('Received execute-transaction request', { action, data });

		try {
			let transactionParams: TransactionParams;

			switch (action) {
				case 'supply_usdc':
				case 'withdraw_usdc':
				case 'borrow_usdc':
				case 'repay_usdc':
				case 'deposit_eth':
				case 'withdraw_eth':
				case 'getBalance':
				case 'repay':
					transactionParams = {
						action,
						params: { amount: data }, // 'data' is amount
					};
					break;
				default:
					throw new Error(`Unsupported action: ${action}`);
			}

			const result = await executeOnChainAction(transactionParams);

			logger.info('On-chain action executed successfully', {
				action,
				// txHash: result.hash, // Uncomment if 'result' contains 'hash'
			});

			res
				.status(200)
				.json({ success: true /* data: { txHash: result.hash } */ });
		} catch (error: any) {
			logger.error('On-chain action execution failed', {
				action,
				error: error.message,
			});
			res.status(500).json({
				success: false,
				message: 'Transaction failed',
				error: error.message,
			});
		}
	}
);

export default router;
