import dotenv from 'dotenv';

dotenv.config();

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optional(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

export const config = {
  port: parseInt(optional('PORT', '3000'), 10),
  nodeEnv: optional('NODE_ENV', 'development'),

  db: {
    host: optional('DB_HOST', 'localhost'),
    port: parseInt(optional('DB_PORT', '5432'), 10),
    name: optional('DB_NAME', 'pago_envio'),
    user: optional('DB_USER', 'postgres'),
    password: optional('DB_PASSWORD', 'postgres'),
  },

  tiendanube: {
    appId: optional('TIENDANUBE_APP_ID', ''),
    appSecret: optional('TIENDANUBE_APP_SECRET', ''),
    webhookSecret: optional('TIENDANUBE_WEBHOOK_SECRET', ''),
  },

  nave: {
    apiKey: optional('NAVE_API_KEY', ''),
    apiSecret: optional('NAVE_API_SECRET', ''),
    webhookSecret: optional('NAVE_WEBHOOK_SECRET', ''),
    baseUrl: optional('NAVE_BASE_URL', 'https://api.nave.com'),
    mode: optional('NAVE_MODE', 'sandbox') as 'sandbox' | 'production',
  },

  app: {
    baseUrl: optional('APP_BASE_URL', 'http://localhost:3000'),
    successUrl: optional('PAYMENT_SUCCESS_URL', 'http://localhost:3000/payment/success'),
    failureUrl: optional('PAYMENT_FAILURE_URL', 'http://localhost:3000/payment/failure'),
  },
} as const;
