import app from './app';
import { config } from './config';
import { getPool, closePool } from './db/client';

async function start(): Promise<void> {
  // Verificar conexión a DB al iniciar
  try {
    const pool = getPool();
    await pool.query('SELECT 1');
    console.log('[Server] Database connection OK');
  } catch (err) {
    console.error('[Server] Cannot connect to database:', err);
    process.exit(1);
  }

  const server = app.listen(config.port, () => {
    console.log(`[Server] pago-envio-diferido running on port ${config.port} (${config.nodeEnv})`);
    console.log(`[Server] Health check: http://localhost:${config.port}/health`);
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[Server] ${signal} received, shutting down gracefully...`);
    server.close(async () => {
      await closePool();
      console.log('[Server] Shutdown complete.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((err) => {
  console.error('[Server] Fatal error:', err);
  process.exit(1);
});
