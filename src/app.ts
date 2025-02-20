import express from 'express';
import morgan from 'morgan';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { metricsMiddleware, setupMetrics } from './utils/metrics';
import logger from './utils/logger';
import listEndpoints from 'express-list-endpoints';
import transactionRoutes from './routes/transactionRoutes';
import { errorHandler } from './middleware/errorHandler';

const app = express();

// Setup Helmet for security
app.use(helmet());
app.use(express.json());

// Setup Rate Limiting
const limiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	max: 100, // limit each IP to 100 requests per windowMs
	message: 'Too many requests from this IP, please try again later.',
});
app.use(limiter);

// Setup Morgan to use Winston's stream
app.use(
	morgan('combined', {
		stream: {
			write: (message: string) => logger.info(message.trim()),
		},
	})
);

// Setup Metrics Middleware
app.use(metricsMiddleware);

app.use('/api', transactionRoutes);

app.get('/health', (_req, res) => {
	res.json({ status: 'OK' });
});

app.get('/routes', (_req, res) => {
	const routes = listEndpoints(app);
	res.json(routes);
});

app.get('/test-log', (_req, res) => {
	logger.info('Test log endpoint accessed');
	res.json({ message: 'Check your logs!' });
});

// Setup Metrics Endpoint
setupMetrics(app);

app.use(errorHandler);

export default app;
