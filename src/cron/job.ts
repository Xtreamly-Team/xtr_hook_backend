import cron from 'node-cron';
import axios from 'axios';
import logger from '../utils/logger';
import { handleApiResponse } from '../scripts/xtrTraderPolicy';
import dotenv from 'dotenv';

dotenv.config(); // Ensure dotenv is configured to read .env variables

// Define the API endpoint (use environment variables for flexibility)
const API_URL =
	process.env.API_URL ||
	'https://api.xtreamly.io/volatility_prediction?symbol=ETH&horizon=1min';
const API_URL_STATE =
	process.env.API_URL_STATE ||
	'https://api.xtreamly.io/state_recognize?symbol=ETH';

// Function to fetch data from the API
const fetchData = async () => {
	try {
		// Make concurrent API calls
		const [dataResponse, stateResponse] = await Promise.all([
			axios.get(API_URL),
			axios.get(API_URL_STATE),
		]);

		// Process the responses
		const data = dataResponse.data; // Handle the data from the first API
		const stateData = stateResponse.data; // Handle the data from the second API

		// Log the data with variables attached
		const volPredictionLog = `Volatility prediction from xtreamly API: ${JSON.stringify(data)}`;
		const statePredictionLog = `State prediction from xtreamly API: ${JSON.stringify(stateData)}`;
		
		console.log(volPredictionLog);
		console.log(statePredictionLog);

		// Return or process the combined data as needed
		return { volPredictionLog, statePredictionLog };
	} catch (error) {
		if (axios.isAxiosError(error)) {
			logger.error('Error fetching data from API:', {
				message: error.message,
				stack: error.stack,
				...(error.response && { response: error.response.data }),
			});
		} else {
			logger.error('Unexpected error:', { error });
		}
		throw error; 
	}
};

// Function to start the cron job
export const startCronJob = () => {
	const interval = process.env.EXECUTION_INTERVAL ? parseInt(process.env.EXECUTION_INTERVAL) : 50;
	console.log(interval);

	// Schedule the job to run at the specified interval
	const task = cron.schedule(
		`*/${interval} * * * * *`,
		async () => {
			try {
				const predictionData = await fetchData(); 

				await handleApiResponse(predictionData); 
			} catch (error) {
				console.error('Error in scheduled task:', error);
			}
		},
		{
			scheduled: true,
			timezone: 'UTC', // Adjust timezone as needed
		}
	);

	logger.info(`Cron job scheduled to run every ${interval} seconds.`);

	return task; // Return the task instance for later control if needed
};

// Function to stop the cron job (useful for graceful shutdown)
export const stopCronJob = (task: cron.ScheduledTask) => {
	if (task) {
		task.stop();
		logger.info('Cron job stopped.');
	}
};
