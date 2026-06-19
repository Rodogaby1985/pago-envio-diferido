import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { getPool } from '../db/client';

const router = Router();

const healthLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

router.get('/', healthLimiter, async (req: Request, res: Response) => {
  let dbStatus = 'ok';
  let dbVersion = '';

  try {
    const pool = getPool();
    const result = await pool.query('SELECT version()');
    dbVersion = result.rows[0]?.version?.split(' ')[1] ?? 'unknown';
  } catch {
    dbStatus = 'error';
  }

  const status = dbStatus === 'ok' ? 200 : 503;

  res.status(status).json({
    status: dbStatus === 'ok' ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    service: 'pago-envio-diferido',
    version: process.env.npm_package_version ?? '1.0.0',
    db: {
      status: dbStatus,
      version: dbVersion,
    },
  });
});

export default router;
