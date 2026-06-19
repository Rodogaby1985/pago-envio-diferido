import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, withTransaction } from '../db/client';
import {
  ShippingCharge,
  ShippingChargeStatus,
  OrderStatus,
  PaymentTransaction,
} from '../domain/entities';
import { canTransitionCharge, canMarkReadyToShip } from '../domain/stateMachine';
import { getPaymentAdapter } from '../adapters/payment';
import { orderService } from './OrderService';
import { config } from '../config';

export class ShippingChargeService {
  /**
   * Crea un link de pago de envío para un pedido.
   * Usa el snapshot de cotización para determinar el monto.
   */
  async createPaymentLink(
    orderId: string,
    provider = 'nave'
  ): Promise<ShippingCharge> {
    const order = await orderService.getById(orderId);
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    if (order.status === OrderStatus.CANCELED) {
      throw new Error(`Cannot create payment link for canceled order`);
    }

    // Obtener cotización de envío
    const quote = await orderService.getShippingQuote(orderId);
    if (!quote) {
      throw new Error(`No shipping quote found for order ${orderId}`);
    }

    // Verificar si ya hay un cobro activo
    const existingCharge = await this.getActiveChargeByOrderId(orderId);
    if (existingCharge && existingCharge.status === ShippingChargeStatus.APPROVED) {
      throw new Error(`Shipping already paid for order ${orderId}`);
    }

    const adapter = getPaymentAdapter(provider);

    const externalOrderId = `TN-${order.nube_order_id}-SHIPPING`;
    const dueDate = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 horas

    const result = await adapter.createPaymentLink({
      externalOrderId,
      amount: Number(quote.quoted_amount),
      currency: quote.quoted_currency,
      description: `Costo de envío pedido #${order.order_number ?? order.nube_order_id}`,
      metadata: {
        order_id: orderId,
        nube_order_id: String(order.nube_order_id),
        store_id: order.store_id,
      },
      successUrl: config.app.successUrl,
      failureUrl: config.app.failureUrl,
      webhookUrl: `${config.app.baseUrl}/webhooks/payments/${provider}`,
      expiresAt: dueDate.toISOString(),
    });

    // Guardar cobro en DB
    const charge = await withTransaction(async (client) => {
      const inserted = await client.query<ShippingCharge>(
        `INSERT INTO shipping_charge
          (order_bridge_id, amount, currency, provider, provider_reference, payment_link, status, attempts, due_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8)
         RETURNING *`,
        [
          orderId,
          quote.quoted_amount,
          quote.quoted_currency,
          provider,
          result.providerReference,
          result.paymentLink,
          ShippingChargeStatus.LINK_SENT,
          dueDate,
        ]
      );

      return inserted.rows[0];
    });

    // Actualizar estado del pedido
    if (order.status === OrderStatus.CREATED) {
      await orderService.updateStatus(orderId, OrderStatus.SHIPPING_PAYMENT_PENDING);
    }

    console.log(`[ShippingChargeService] Payment link created for order ${orderId}: ${result.paymentLink}`);
    return charge;
  }

  /**
   * Obtiene el cobro activo (no cancelado/expirado) para un pedido.
   */
  async getActiveChargeByOrderId(orderId: string): Promise<ShippingCharge | null> {
    return queryOne<ShippingCharge>(
      `SELECT * FROM shipping_charge
       WHERE order_bridge_id = $1
       AND status NOT IN ('CANCELED', 'EXPIRED')
       ORDER BY created_at DESC LIMIT 1`,
      [orderId]
    );
  }

  /**
   * Obtiene todos los cobros de un pedido.
   */
  async getChargesByOrderId(orderId: string): Promise<ShippingCharge[]> {
    return query<ShippingCharge>(
      `SELECT * FROM shipping_charge WHERE order_bridge_id = $1 ORDER BY created_at DESC`,
      [orderId]
    );
  }

  /**
   * Obtiene un cobro por su referencia del proveedor.
   */
  async getChargeByProviderReference(
    provider: string,
    providerReference: string
  ): Promise<ShippingCharge | null> {
    return queryOne<ShippingCharge>(
      `SELECT * FROM shipping_charge WHERE provider = $1 AND provider_reference = $2`,
      [provider, providerReference]
    );
  }

  /**
   * Procesa un webhook de pago.
   * Implementa idempotencia usando provider_event_id único.
   */
  async processWebhook(
    provider: string,
    rawPayload: unknown,
    headers: Record<string, string>
  ): Promise<{ alreadyProcessed: boolean; charge?: ShippingCharge }> {
    const adapter = getPaymentAdapter(provider);

    // Parsear y validar el webhook
    const event = await adapter.parseWebhook(rawPayload, headers);

    // Idempotencia: verificar si el evento ya fue procesado
    const existingTx = await queryOne<PaymentTransaction>(
      'SELECT * FROM payment_transaction WHERE provider_event_id = $1',
      [event.providerEventId]
    );

    if (existingTx) {
      console.log(`[ShippingChargeService] Event ${event.providerEventId} already processed, skipping.`);
      return { alreadyProcessed: true };
    }

    // Buscar el cobro por referencia del proveedor
    const charge = await this.getChargeByProviderReference(provider, event.providerReference);
    if (!charge) {
      console.warn(`[ShippingChargeService] No charge found for provider reference: ${event.providerReference}`);
      // Registrar el evento de todas formas para auditoría
      await queryOne(
        `INSERT INTO payment_transaction
          (shipping_charge_id, provider_event_id, event_type, status, paid_amount, currency, raw_payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (provider_event_id) DO NOTHING`,
        [
          '00000000-0000-0000-0000-000000000000', // placeholder
          event.providerEventId,
          'webhook',
          event.status,
          event.paidAmount ?? null,
          event.currency ?? null,
          JSON.stringify(event.raw),
        ]
      ).catch(() => {}); // ignorar si falla por FK

      return { alreadyProcessed: false };
    }

    return withTransaction(async (client) => {
      // Registrar la transacción (idempotente por UNIQUE en provider_event_id)
      await client.query(
        `INSERT INTO payment_transaction
          (shipping_charge_id, provider_event_id, event_type, status, paid_amount, currency, raw_payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (provider_event_id) DO NOTHING`,
        [
          charge.id,
          event.providerEventId,
          'webhook',
          event.status,
          event.paidAmount ?? null,
          event.currency ?? null,
          JSON.stringify(event.raw),
        ]
      );

      // Mapear estado del evento al estado interno del cobro
      const newChargeStatus = this.mapEventStatusToChargeStatus(event.status);

      // Actualizar estado del cobro si la transición es válida
      if (canTransitionCharge(charge.status, newChargeStatus)) {
        await client.query(
          `UPDATE shipping_charge SET status = $1, updated_at = NOW() WHERE id = $2`,
          [newChargeStatus, charge.id]
        );

        console.log(`[ShippingChargeService] Charge ${charge.id} status: ${charge.status} -> ${newChargeStatus}`);

        // Si el pago fue aprobado, actualizar el pedido
        if (newChargeStatus === ShippingChargeStatus.APPROVED) {
          await client.query(
            `UPDATE order_bridge SET status = $1, updated_at = NOW()
             WHERE id = $2 AND status = $3`,
            [OrderStatus.SHIPPING_PAID, charge.order_bridge_id, OrderStatus.SHIPPING_PAYMENT_PENDING]
          );

          console.log(`[ShippingChargeService] Order ${charge.order_bridge_id} marked as SHIPPING_PAID`);

          // Verificar si procede marcar como READY_TO_SHIP
          await this.tryMarkReadyToShip(client, charge.order_bridge_id, newChargeStatus);
        }
      }

      const updatedCharge = await client.query<ShippingCharge>(
        'SELECT * FROM shipping_charge WHERE id = $1',
        [charge.id]
      );

      return {
        alreadyProcessed: false,
        charge: updatedCharge.rows[0],
      };
    });
  }

  /**
   * Intenta marcar el pedido como READY_TO_SHIP.
   * Regla de negocio: solo si pago de envío está aprobado.
   */
  private async tryMarkReadyToShip(
    client: import('pg').PoolClient,
    orderId: string,
    chargeStatus: ShippingChargeStatus
  ): Promise<void> {
    const orderResult = await client.query<{ status: OrderStatus }>(
      'SELECT status FROM order_bridge WHERE id = $1',
      [orderId]
    );

    const order = orderResult.rows[0];
    if (!order) return;

    if (canMarkReadyToShip(order.status, chargeStatus)) {
      await client.query(
        `UPDATE order_bridge SET status = $1, updated_at = NOW() WHERE id = $2`,
        [OrderStatus.READY_TO_SHIP, orderId]
      );
      console.log(`[ShippingChargeService] Order ${orderId} marked as READY_TO_SHIP`);
    }
  }

  /**
   * Mapea el estado del evento de pago al estado interno del cobro.
   */
  private mapEventStatusToChargeStatus(
    eventStatus: string
  ): ShippingChargeStatus {
    const map: Record<string, ShippingChargeStatus> = {
      PENDING: ShippingChargeStatus.PENDING,
      APPROVED: ShippingChargeStatus.APPROVED,
      REJECTED: ShippingChargeStatus.REJECTED,
      EXPIRED: ShippingChargeStatus.EXPIRED,
      CANCELED: ShippingChargeStatus.CANCELED,
    };
    return map[eventStatus] ?? ShippingChargeStatus.PENDING;
  }

  /**
   * Obtiene el estado completo del cobro de envío para un pedido.
   */
  async getStatusByOrderId(orderId: string): Promise<{
    order: { id: string; status: string; nube_order_id: number } | null;
    charge: ShippingCharge | null;
    quote: { quoted_amount: number; quoted_currency: string } | null;
  }> {
    const order = await orderService.getById(orderId);
    const charge = await this.getActiveChargeByOrderId(orderId);
    const quote = await orderService.getShippingQuote(orderId);

    return {
      order: order
        ? { id: order.id, status: order.status, nube_order_id: order.nube_order_id }
        : null,
      charge,
      quote: quote
        ? { quoted_amount: Number(quote.quoted_amount), quoted_currency: quote.quoted_currency }
        : null,
    };
  }
}

export const shippingChargeService = new ShippingChargeService();
