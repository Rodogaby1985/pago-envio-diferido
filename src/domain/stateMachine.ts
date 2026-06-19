import { OrderStatus, ShippingChargeStatus } from './entities';

/**
 * Máquina de estados mínima para el cobro de envío.
 *
 * Transiciones permitidas:
 *   CREATED -> SHIPPING_PAYMENT_PENDING  (link generado)
 *   SHIPPING_PAYMENT_PENDING -> SHIPPING_PAID  (pago aprobado)
 *   SHIPPING_PAID -> READY_TO_SHIP  (pago de productos también OK)
 *   * -> CANCELED
 */
const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.CREATED]: [OrderStatus.SHIPPING_PAYMENT_PENDING, OrderStatus.CANCELED],
  [OrderStatus.SHIPPING_PAYMENT_PENDING]: [OrderStatus.SHIPPING_PAID, OrderStatus.CANCELED],
  [OrderStatus.SHIPPING_PAID]: [OrderStatus.READY_TO_SHIP, OrderStatus.CANCELED],
  [OrderStatus.READY_TO_SHIP]: [OrderStatus.CANCELED],
  [OrderStatus.CANCELED]: [],
};

/**
 * Verifica si una transición de estado de pedido es válida.
 */
export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Transiciones permitidas para shipping_charge
 */
const CHARGE_TRANSITIONS: Record<ShippingChargeStatus, ShippingChargeStatus[]> = {
  [ShippingChargeStatus.INITIATED]: [ShippingChargeStatus.LINK_SENT, ShippingChargeStatus.CANCELED],
  [ShippingChargeStatus.LINK_SENT]: [ShippingChargeStatus.PENDING, ShippingChargeStatus.EXPIRED, ShippingChargeStatus.CANCELED],
  [ShippingChargeStatus.PENDING]: [ShippingChargeStatus.APPROVED, ShippingChargeStatus.REJECTED, ShippingChargeStatus.EXPIRED, ShippingChargeStatus.CANCELED],
  [ShippingChargeStatus.APPROVED]: [],
  [ShippingChargeStatus.REJECTED]: [ShippingChargeStatus.INITIATED],
  [ShippingChargeStatus.EXPIRED]: [ShippingChargeStatus.INITIATED],
  [ShippingChargeStatus.CANCELED]: [],
};

export function canTransitionCharge(
  from: ShippingChargeStatus,
  to: ShippingChargeStatus
): boolean {
  return CHARGE_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Regla de negocio: NO marcar READY_TO_SHIP sin pago de envío aprobado.
 */
export function canMarkReadyToShip(
  orderStatus: OrderStatus,
  chargeStatus: ShippingChargeStatus
): boolean {
  return (
    orderStatus === OrderStatus.SHIPPING_PAID &&
    chargeStatus === ShippingChargeStatus.APPROVED
  );
}
