import { query, queryOne, withTransaction } from '../db/client';
import {
  OrderBridge,
  OrderStatus,
  ShippingCharge,
  ShippingChargeStatus,
  ShippingQuoteSnapshot,
  Store,
} from '../domain/entities';
import { canTransitionOrder } from '../domain/stateMachine';

export interface CreateOrderInput {
  store_id: string;
  nube_order_id: number;
  order_number?: string;
  currency?: string;
  products_total: number;
  shipping_mode?: string;
  raw_payload?: Record<string, unknown>;
  shipping_quoted_amount?: number;
  shipping_quote_source?: string;
}

export class OrderService {
  /**
   * Registra o actualiza un pedido de Tiendanube.
   * Si ya existe, devuelve el existente (idempotente).
   */
  async upsertOrder(input: CreateOrderInput): Promise<OrderBridge> {
    return withTransaction(async (client) => {
      // Verificar si ya existe
      const existing = await client.query<OrderBridge>(
        'SELECT * FROM order_bridge WHERE store_id = $1 AND nube_order_id = $2',
        [input.store_id, input.nube_order_id]
      );

      if (existing.rows.length > 0) {
        console.log(`[OrderService] Order ${input.nube_order_id} already exists, returning existing.`);
        return existing.rows[0];
      }

      // Crear nuevo pedido
      const result = await client.query<OrderBridge>(
        `INSERT INTO order_bridge
          (store_id, nube_order_id, order_number, currency, products_total, shipping_mode, status, raw_payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          input.store_id,
          input.nube_order_id,
          input.order_number ?? null,
          input.currency ?? 'ARS',
          input.products_total,
          input.shipping_mode ?? null,
          OrderStatus.CREATED,
          input.raw_payload ? JSON.stringify(input.raw_payload) : null,
        ]
      );

      const order = result.rows[0];

      // Guardar snapshot de cotización si se proveyó
      if (input.shipping_quoted_amount != null) {
        await client.query(
          `INSERT INTO shipping_quote_snapshot
            (order_bridge_id, quoted_amount, quoted_currency, quote_source)
           VALUES ($1, $2, $3, $4)`,
          [
            order.id,
            input.shipping_quoted_amount,
            input.currency ?? 'ARS',
            input.shipping_quote_source ?? 'tiendanube',
          ]
        );
      }

      return order;
    });
  }

  /**
   * Obtiene un pedido por su ID interno.
   */
  async getById(orderId: string): Promise<OrderBridge | null> {
    return queryOne<OrderBridge>(
      'SELECT * FROM order_bridge WHERE id = $1',
      [orderId]
    );
  }

  /**
   * Obtiene un pedido por su ID de Tiendanube y store.
   */
  async getByNubeOrderId(
    storeId: string,
    nubeOrderId: number
  ): Promise<OrderBridge | null> {
    return queryOne<OrderBridge>(
      'SELECT * FROM order_bridge WHERE store_id = $1 AND nube_order_id = $2',
      [storeId, nubeOrderId]
    );
  }

  /**
   * Actualiza el estado de un pedido con validación de transición.
   */
  async updateStatus(
    orderId: string,
    newStatus: OrderStatus
  ): Promise<OrderBridge> {
    const order = await this.getById(orderId);
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    if (!canTransitionOrder(order.status, newStatus)) {
      throw new Error(
        `Invalid order status transition: ${order.status} -> ${newStatus}`
      );
    }

    const updated = await queryOne<OrderBridge>(
      `UPDATE order_bridge SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [newStatus, orderId]
    );

    if (!updated) {
      throw new Error(`Failed to update order ${orderId}`);
    }

    console.log(`[OrderService] Order ${orderId} status: ${order.status} -> ${newStatus}`);
    return updated;
  }

  /**
   * Obtiene el snapshot de cotización de envío para un pedido.
   */
  async getShippingQuote(orderId: string): Promise<ShippingQuoteSnapshot | null> {
    return queryOne<ShippingQuoteSnapshot>(
      `SELECT * FROM shipping_quote_snapshot WHERE order_bridge_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [orderId]
    );
  }

  /**
   * Lista pedidos por estado.
   */
  async listByStatus(status: OrderStatus, limit = 50): Promise<OrderBridge[]> {
    return query<OrderBridge>(
      'SELECT * FROM order_bridge WHERE status = $1 ORDER BY created_at DESC LIMIT $2',
      [status, limit]
    );
  }

  /**
   * Obtiene o crea la tienda por su ID de Nube.
   */
  async upsertStore(input: {
    nube_store_id: string;
    access_token: string;
    store_name?: string;
    store_email?: string;
  }): Promise<Store> {
    const existing = await queryOne<Store>(
      'SELECT * FROM stores WHERE nube_store_id = $1',
      [input.nube_store_id]
    );

    if (existing) {
      // Actualizar token si cambió
      const updated = await queryOne<Store>(
        `UPDATE stores SET access_token = $1, store_name = COALESCE($2, store_name),
         store_email = COALESCE($3, store_email), updated_at = NOW()
         WHERE nube_store_id = $4 RETURNING *`,
        [input.access_token, input.store_name ?? null, input.store_email ?? null, input.nube_store_id]
      );
      return updated!;
    }

    const created = await queryOne<Store>(
      `INSERT INTO stores (nube_store_id, access_token, store_name, store_email)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [input.nube_store_id, input.access_token, input.store_name ?? null, input.store_email ?? null]
    );

    return created!;
  }

  /**
   * Obtiene tienda por su ID de Nube.
   */
  async getStoreByNubeId(nubeStoreId: string): Promise<Store | null> {
    return queryOne<Store>(
      'SELECT * FROM stores WHERE nube_store_id = $1 AND status = $2',
      [nubeStoreId, 'ACTIVE']
    );
  }
}

export const orderService = new OrderService();
