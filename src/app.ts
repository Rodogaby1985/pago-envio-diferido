import express from 'express';
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

// Rutas
app.use('/health', healthRouter);
app.use('/webhooks/tiendanube', tiendanubeWebhookRouter);
app.use('/webhooks/payments', paymentsWebhookRouter);
app.use('/orders/:orderId/shipping-charge', shippingChargeRouter);

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use(errorHandler);

export default app;
