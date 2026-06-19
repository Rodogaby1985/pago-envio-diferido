import { Router, Request, Response, NextFunction } from 'express';
import { orderService } from '../../services/OrderService';
import { createError } from '../../middleware/errorHandler';

const router = Router();

/**
 * POST /webhooks/tiendanube/order-created
 *
 * Recibe el webhook de orden creada de Tiendanube.
 * Payload esperado (simplificado de Tiendanube):
 * {
 *   store_id: string,
 *   event: "order/created",
 *   id: number,            // nube_order_id
 *   order: {
 *     id: number,
 *     number: string,
 *     currency: string,
 *     total: string,
 *     subtotal: string,
 *     shipping: {
 *       cost: string,
 *       method: string
 *     },
 *     contact_email: string
 *   }
 * }
 */
router.post('/order-created', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as Record<string, unknown>;

    // Validación básica del payload
    if (!body.store_id) {
      return next(createError('Missing store_id in webhook payload', 400));
    }

    const nubeStoreId = String(body.store_id);
    const orderData = (body.order ?? body) as Record<string, unknown>;
    const nubeOrderId = Number(body.id ?? orderData.id);

    if (!nubeOrderId || isNaN(nubeOrderId)) {
      return next(createError('Missing or invalid order id in webhook payload', 400));
    }

    console.log(`[Webhook TN] order-created: store=${nubeStoreId} order=${nubeOrderId}`);

    // Obtener o crear la tienda (en producción usar OAuth token real)
    let store = await orderService.getStoreByNubeId(nubeStoreId);
    if (!store) {
      // Crear tienda placeholder; en producción el token viene de OAuth
      store = await orderService.upsertStore({
        nube_store_id: nubeStoreId,
        access_token: 'PENDING_OAUTH',
        store_name: `Tienda ${nubeStoreId}`,
      });
      console.log(`[Webhook TN] Created placeholder store for ${nubeStoreId}`);
    }

    const shipping = orderData.shipping as Record<string, unknown> | undefined;
    const shippingCost = shipping?.cost
      ? parseFloat(String(shipping.cost))
      : undefined;
    const shippingMethod = (shipping?.method as string | undefined) ?? undefined;

    const productsTotal = parseFloat(
      String(orderData.subtotal ?? orderData.total ?? '0')
    );

    // Crear el pedido vinculado
    const order = await orderService.upsertOrder({
      store_id: store.id,
      nube_order_id: nubeOrderId,
      order_number: String(orderData.number ?? nubeOrderId),
      currency: (orderData.currency as string | undefined) ?? 'ARS',
      products_total: productsTotal,
      shipping_mode: shippingMethod,
      raw_payload: body,
      shipping_quoted_amount: shippingCost,
      shipping_quote_source: 'tiendanube',
    });

    res.status(200).json({
      ok: true,
      order_id: order.id,
      nube_order_id: nubeOrderId,
      status: order.status,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
