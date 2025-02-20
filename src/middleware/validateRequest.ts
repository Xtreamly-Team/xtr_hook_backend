// src/middleware/validateRequest.ts

import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import logger from '../utils/logger';

const supplySchema = Joi.object({
	action: Joi.string().valid('supply').required(),
	data: Joi.object({
		contractAddress: Joi.string()
			.regex(/^0x[a-fA-F0-9]{40}$/)
			.required(),
		amount: Joi.string()
			.regex(/^\d+(\.\d+)?$/)
			.required(), // Ensures amount is a number string
	}).required(),
});

// Add schemas for other actions as you implement them
// const withdrawSchema = Joi.object({ ... });
// const repaySchema = Joi.object({ ... });
// const getBalanceSchema = Joi.object({ ... });

const schemaMap: Record<string, Joi.ObjectSchema> = {
	supply: supplySchema,
	// withdraw: withdrawSchema,
	// repay: repaySchema,
	// getBalance: getBalanceSchema,
};

export const validateTransaction = (
	req: Request,
	res: Response,
	next: NextFunction
) => {
	const { action } = req.body;

	const schema = schemaMap[action];

	if (!schema) {
		logger.warn('Validation failed: Unsupported action', { action });
		return res
			.status(400)
			.json({ success: false, message: `Unsupported action: ${action}` });
	}

	const { error } = schema.validate(req.body);

	if (error) {
		logger.warn('Transaction request validation failed', {
			error: error.details[0].message,
		});
		return res
			.status(400)
			.json({ success: false, message: error.details[0].message });
	}

	next();
};
