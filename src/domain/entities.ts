// Estado del pedido (order_bridge)
export enum OrderStatus {
  CREATED = 'CREATED',
  SHIPPING_PAYMENT_PENDING = 'SHIPPING_PAYMENT_PENDING',
  SHIPPING_PAID = 'SHIPPING_PAID',
  READY_TO_SHIP = 'READY_TO_SHIP',
  CANCELED = 'CANCELED',
}

// Estado del cobro de envío (shipping_charge)
export enum ShippingChargeStatus {
  INITIATED = 'INITIATED',
  LINK_SENT = 'LINK_SENT',
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
  CANCELED = 'CANCELED',
}

// Entidades del dominio
export interface Store {
  id: string;
  nube_store_id: string;
  access_token: string;
  store_name: string | null;
  store_email: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export interface OrderBridge {
  id: string;
  store_id: string;
  nube_order_id: number;
  order_number: string | null;
  currency: string;
  products_total: number;
  shipping_mode: string | null;
  status: OrderStatus;
  raw_payload: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

export interface ShippingQuoteSnapshot {
  id: string;
  order_bridge_id: string;
  quoted_amount: number;
  quoted_currency: string;
  quote_source: string | null;
  quote_metadata: Record<string, unknown> | null;
  created_at: Date;
}

export interface ShippingCharge {
  id: string;
  order_bridge_id: string;
  amount: number;
  currency: string;
  provider: string;
  provider_reference: string | null;
  payment_link: string | null;
  status: ShippingChargeStatus;
  attempts: number;
  due_date: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface PaymentTransaction {
  id: string;
  shipping_charge_id: string;
  provider_event_id: string;
  event_type: string;
  status: string | null;
  paid_amount: number | null;
  currency: string | null;
  raw_payload: Record<string, unknown> | null;
  processed_at: Date;
}
