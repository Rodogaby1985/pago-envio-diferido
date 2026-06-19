import { Router, Request, Response, NextFunction } from 'express';
import { shippingChargeService } from '../../services/ShippingChargeService';
import { orderService } from '../../services/OrderService';
import { createError } from '../../middleware/errorHandler';

const router = Router({ mergeParams: true });

/**
 * POST /orders/:orderId/shipping-charge/create-link
 *
 * Crea un link de pago de envío separado para un pedido.
 * Body opcional: { provider: "nave" }
 */
router.post('/create-link', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId } = req.params;
    const { provider = 'nave' } = req.body as { provider?: string };

    if (!orderId) {
      return next(createError('Missing orderId', 400));
    }

    console.log(`[Orders] Creating shipping payment link for order ${orderId}`);

    const charge = await shippingChargeService.createPaymentLink(orderId, provider);

    res.status(201).json({
      ok: true,
      charge_id: charge.id,
      payment_link: charge.payment_link,
      amount: Number(charge.amount),
      currency: charge.currency,
      provider: charge.provider,
      status: charge.status,
      due_date: charge.due_date,
    });
  } catch (err) {
    if (err instanceof Error) {
      if (
        err.message.includes('not found') ||
        err.message.includes('No shipping quote')
      ) {
        return next(createError(err.message, 404));
      }
      if (
        err.message.includes('already paid') ||
        err.message.includes('canceled order')
      ) {
        return next(createError(err.message, 409));
      }
    }
    next(err);
  }
});

/**
 * GET /orders/:orderId/shipping-charge/status
 *
 * Consulta el estado del cobro de envío para un pedido.
 */
router.get('/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId } = req.params;

    if (!orderId) {
      return next(createError('Missing orderId', 400));
    }

    const result = await shippingChargeService.getStatusByOrderId(orderId);

    if (!result.order) {
      return next(createError(`Order ${orderId} not found`, 404));
    }

    res.status(200).json({
      ok: true,
      order_id: orderId,
      order_status: result.order.status,
      nube_order_id: result.order.nube_order_id,
      shipping_quote: result.quote,
      shipping_charge: result.charge
        ? {
            id: result.charge.id,
            status: result.charge.status,
            amount: Number(result.charge.amount),
            currency: result.charge.currency,
            payment_link: result.charge.payment_link,
            provider: result.charge.provider,
            due_date: result.charge.due_date,
          }
        : null,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
