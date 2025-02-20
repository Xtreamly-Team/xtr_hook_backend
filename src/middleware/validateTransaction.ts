import { Request, Response, NextFunction, RequestHandler } from 'express';
import Joi from 'joi';
import { OnChainAction } from '../types/TransactionTypes';

// Define validation schemas for each action
const supplyWithdrawRepaySchema = Joi.object({
	action: Joi.string().valid('supply', 'withdraw', 'repay').required(),
	data: Joi.string().required(), // Represents 'amount' as a string
});

const getBalanceSchema = Joi.object({
	action: Joi.string().valid('getBalance').required(),
	data: Joi.string().required(), // Represents 'account' as a string
});

// Combine schemas using alternatives
const schema = Joi.alternatives().try(
	supplyWithdrawRepaySchema,
	getBalanceSchema
);

/**
 * Middleware to validate transaction requests
 */
export const validateTransaction: RequestHandler = (
	req: Request,
	res: Response,
	next: NextFunction
): void => {
	const { error } = schema.validate(req.body);
	if (error) {
		res.status(400).json({ success: false, message: error.details[0].message });
		return; // Ensure the function returns after sending a response
	}
	next();
};
