import dotenv from 'dotenv';
dotenv.config(); // Load .env

import app from './app';
import { startCronJob, stopCronJob } from './cron/job';
import logger from './utils/logger';
import { cleanEnv, str } from 'envalid';

// Validate environment variables
const env = cleanEnv(process.env, {
	PRIVATE_KEY: str(),
	ARBITRUM_SEPOLIA_RPC: str(),
	PORT: str({ default: '3001' }),
});

const PORT = env.PORT;

// Start the server
const server = app.listen(PORT, () => {
	logger.info(`Server is running on port ${PORT}`);
	// Start cron job after server is up
	const cronTask = startCronJob();

	// Handle graceful shutdown
	const gracefulShutdown = () => {
		logger.info('Received shutdown signal. Shutting down gracefully...');

		// Stop the cron job
		stopCronJob(cronTask);

		// Close the server
		server.close(() => {
			logger.info('Closed out remaining connections.');
			process.exit(0);
		});

		// Force exit if not closed within 10 seconds
		setTimeout(() => {
			logger.error(
				'Could not close connections in time. Forcefully shutting down.'
			);
			process.exit(1);
		}, 10 * 1000);
	};

	// Listen for termination signals
	process.on('SIGTERM', gracefulShutdown);
	process.on('SIGINT', gracefulShutdown);
});
