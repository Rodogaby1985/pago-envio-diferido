import { Router, Request, Response, NextFunction } from 'express';
import { shippingChargeService } from '../../services/ShippingChargeService';

const router = Router();

/**
 * POST /webhooks/payments/:provider
 *
 * Recibe webhooks de pagos de cualquier proveedor registrado.
 * Actualmente soportado: nave
 *
 * Ejemplo para NAVE:
 * POST /webhooks/payments/nave
 * Headers: X-Nave-Signature: sha256=<hmac>
 * Body: {
 *   event_id: "evt_123",
 *   payment_id: "pay_456",
 *   status: "approved",
 *   amount: 1500.00,
 *   currency: "ARS",
 *   occurred_at: "2024-01-01T12:00:00Z"
 * }
 */
router.post('/:provider', async (req: Request, res: Response, next: NextFunction) => {
  const { provider } = req.params;

  try {
    console.log(`[Webhook Payment] Received webhook from provider: ${provider}`);

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') {
        headers[key] = value;
      }
    }

    const result = await shippingChargeService.processWebhook(
      provider,
      req.body as unknown,
      headers
    );

    if (result.alreadyProcessed) {
      return res.status(200).json({ ok: true, message: 'Event already processed' });
    }

    res.status(200).json({
      ok: true,
      charge_id: result.charge?.id,
      charge_status: result.charge?.status,
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes('not supported')) {
      return res.status(400).json({ error: `Provider '${provider}' not supported` });
    }
    if (err instanceof Error && err.message.includes('signature')) {
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }
    next(err);
  }
});

export default router;
