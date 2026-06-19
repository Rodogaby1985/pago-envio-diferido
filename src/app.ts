import express from 'express';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { errorHandler } from './middleware/errorHandler';
import healthRouter from './routes/health';
import tiendanubeWebhookRouter from './routes/webhooks/tiendanube';
import paymentsWebhookRouter from './routes/webhooks/payments';
import shippingChargeRouter from './routes/orders/shippingCharge';

const app = express();

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging básico de requests
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Rate limiting general para endpoints de API
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiting estricto para webhooks
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});

// Rutas
app.use('/health', healthRouter);
app.use('/webhooks/tiendanube', webhookLimiter, tiendanubeWebhookRouter);
app.use('/webhooks/payments', webhookLimiter, paymentsWebhookRouter);
app.use('/orders/:orderId/shipping-charge', apiLimiter, shippingChargeRouter);

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use(errorHandler);

export default app;
