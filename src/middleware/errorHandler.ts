import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

export function errorHandler(
	err: any,
	req: Request,
	res: Response,
	next: NextFunction
) {
	logger.error('Unhandled Error', {
		message: err.message,
		stack: err.stack,
		route: req.originalUrl,
		method: req.method,
	});

	res.status(500).json({
		success: false,
		message: 'Internal Server Error',
		error: process.env.NODE_ENV === 'development' ? err.message : undefined, // Avoid exposing errors in production
	});
}
