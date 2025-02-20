import client from 'prom-client';
import express from 'express';
import logger from './logger';

// Create a Registry to register the metrics
const register = new client.Registry();

// Add default labels
register.setDefaultLabels({
	app: 'xtr_defi_backend',
});

// Collect default metrics
client.collectDefaultMetrics({ register });

// Define custom metrics if needed
export const httpRequestDurationMicroseconds = new client.Histogram({
	name: 'http_request_duration_ms',
	help: 'Duration of HTTP requests in ms',
	labelNames: ['method', 'route', 'status_code'],
	buckets: [50, 100, 200, 300, 400, 500, 1000], // Customize as needed
});

// Register custom metrics
register.registerMetric(httpRequestDurationMicroseconds);

// Middleware to measure HTTP request durations
export const metricsMiddleware = (
	req: express.Request,
	res: express.Response,
	next: express.NextFunction
) => {
	const start = Date.now();
	res.on('finish', () => {
		const duration = Date.now() - start;
		httpRequestDurationMicroseconds
			.labels(
				req.method,
				req.route ? req.route.path : req.path,
				res.statusCode.toString()
			)
			.observe(duration);
	});
	next();
};

// Endpoint to expose metrics
export const setupMetrics = (app: express.Express) => {
	app.get('/metrics', async (_req, res) => {
		try {
			res.set('Content-Type', register.contentType);
			res.end(await register.metrics());
		} catch (ex) {
			logger.error('Error collecting metrics', { error: ex });
			res.status(500).end();
		}
	});
};
