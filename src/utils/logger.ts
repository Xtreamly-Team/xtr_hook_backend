import { createLogger, format, transports, Logform } from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import fs from 'fs';

// Ensure logs directory exists
const logDir = 'logs';
if (!fs.existsSync(logDir)) {
	fs.mkdirSync(logDir);
}

// Define ANSI escape codes for styling
const styles = {
	reset: '\x1b[0m',
	bold: '\x1b[1m',
	// Define colors with an index signature
	colors: {
		info: '\x1b[94m', // Light Blue
		warn: '\x1b[33m', // Yellow
		error: '\x1b[31m', // Red
		debug: '\x1b[32m', // Green
		json: '\x1b[96m', // Light Cyan for JSON objects
	},
} as const;

// Cast colors to Record<string, string> to allow dynamic indexing
const colorMap: Record<string, string> = styles.colors;

// Helper function to format multi-line messages with color
const formatMessage = (message: string, color: string) => {
	const lines = message.split('\n');
	if (lines.length === 1) {
		return `${styles.bold}${color}${lines[0]}${styles.reset}`;
	}

	const mainLine = `${styles.bold}${color}${lines[0]}${styles.reset}`;
	const additionalLines = lines
		.slice(1)
		.map((line) => `${styles.colors.json}${line}${styles.reset}`)
		.join('\n');

	return `${mainLine}\n${additionalLines}`;
};

// Custom format for console logging with styles
const consoleFormat = format.combine(
	format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
	format.printf((info: Logform.TransformableInfo) => {
		const { level, message, timestamp, ...metadata } = info;

		// Determine color based on log level
		const levelLower = level.toLowerCase();
		const color = colorMap[levelLower] || colorMap.info;

		// Prepare the main message
		let formattedMessage: string = '';

		if (typeof message === 'object' && message !== null) {
			formattedMessage = JSON.stringify(message, null, 2);
		} else if (typeof message === 'string') {
			formattedMessage = message;
		} else {
			formattedMessage = String(message);
		}

		// If there is metadata, append it as pretty JSON
		if (Object.keys(metadata).length) {
			formattedMessage += `\n${JSON.stringify(metadata, null, 2)}`;
		}

		// Apply formatting to message
		const styledMessage = formatMessage(formattedMessage, color);

		// Combine timestamp, level, and message with styling
		return `${styles.bold}${timestamp}${styles.reset} │ [${styles.bold}${color}${level.toUpperCase()}${styles.reset}]: ${styledMessage}`;
	})
);

// Custom format for file logging (JSON)
const fileFormat = format.combine(
	format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
	format.errors({ stack: true }), // Include stack trace for errors
	format.splat(),
	format.json() // Output logs in JSON format
);

const logger = createLogger({
	level: process.env.NODE_ENV === 'production' ? 'warn' : 'info', // Dynamic log level
	format: fileFormat, // Default format for all file transports
	transports: [
		new transports.Console({
			format: consoleFormat, // Use custom console format
		}),
		new DailyRotateFile({
			filename: path.join(logDir, 'error-%DATE%.log'),
			datePattern: 'YYYY-MM-DD',
			level: 'error',
			zippedArchive: true,
			maxSize: '20m',
			maxFiles: '14d',
			format: fileFormat, // Ensure file logs use JSON format
		}),
		new DailyRotateFile({
			filename: path.join(logDir, 'combined-%DATE%.log'),
			datePattern: 'YYYY-MM-DD',
			zippedArchive: true,
			maxSize: '20m',
			maxFiles: '14d',
			format: fileFormat, // Ensure file logs use JSON format
		}),
	],
	exceptionHandlers: [
		new transports.File({ filename: path.join(logDir, 'exceptions.log') }),
	],
	rejectionHandlers: [
		new transports.File({ filename: path.join(logDir, 'rejections.log') }),
	],
});

export default logger;

// const logger_basic = createLogger({
// 	level: 'info', // Default log level
// 	format: format.combine(
// 		format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
// 		format.errors({ stack: true }), // Include stack trace for errors
// 		format.splat(),
// 		format.json() // Output logs in JSON format
// 	),
// 	transports: [
// 		new transports.Console({
// 			format: format.combine(
// 				format.colorize(), // Colorize logs for console
// 				format.simple() // Simple format for readability
// 			),
// 		}),
// 		new transports.File({
// 			filename: path.join(logDir, 'error.log'),
// 			level: 'error',
// 		}),
// 		new transports.File({ filename: path.join(logDir, 'combined.log') }),
// 	],
// 	exceptionHandlers: [
// 		new transports.File({ filename: path.join(logDir, 'exceptions.log') }),
// 	],
// 	rejectionHandlers: [
// 		new transports.File({ filename: path.join(logDir, 'rejections.log') }),
// 	],
// });

// // Custom format for console logging
// const consoleFormat = format.combine(
// 	format.colorize(),
// 	format.printf(({ level, message, timestamp, ...metadata }) => {
// 		let msg = `${timestamp} [${level}]: ${message}`;
// 		if (Object.keys(metadata).length) {
// 			msg += ` ${JSON.stringify(metadata, null, 2)}`; // Pretty-print metadata
// 		}
// 		return msg;
// 	})
// );

// // Custom format for file logging (JSON)
// const fileFormat = format.combine(
// 	format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
// 	format.errors({ stack: true }), // Include stack trace for errors
// 	format.splat(),
// 	format.json() // Output logs in JSON format
// );
