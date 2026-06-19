/**
 * Interfaz común para adaptadores de pasarela de pago.
 * Permite intercambiar proveedores sin cambiar la lógica de negocio.
 */

export interface CreatePaymentLinkInput {
  externalOrderId: string;       // Ej: "TN-12345-SHIPPING"
  amount: number;
  currency: string;              // Ej: "ARS"
  description: string;           // Ej: "Costo de envío pedido #12345"
  payer?: {
    email?: string;
    name?: string;
    phone?: string;
  };
  metadata: Record<string, string>;
  successUrl: string;
  failureUrl: string;
  webhookUrl: string;
  expiresAt?: string;            // ISO 8601
}

export interface CreatePaymentLinkResult {
  providerReference: string;
  paymentLink: string;
  status: 'PENDING' | 'APPROVED';
  raw: unknown;
}

export interface ParsedWebhookEvent {
  providerEventId: string;
  providerReference: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'CANCELED';
  paidAmount?: number;
  currency?: string;
  occurredAt: string;            // ISO 8601
  raw: unknown;
}

export interface PaymentStatusResult {
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'CANCELED';
  raw: unknown;
}

export interface PaymentProviderAdapter {
  /**
   * Nombre del proveedor (ej: "nave", "mercadopago")
   */
  name(): string;

  /**
   * Crea un link de pago para cobrar el envío.
   */
  createPaymentLink(input: CreatePaymentLinkInput): Promise<CreatePaymentLinkResult>;

  /**
   * Parsea y valida un webhook recibido del proveedor.
   * Lanza error si la firma es inválida.
   */
  parseWebhook(
    payload: unknown,
    headers: Record<string, string>
  ): Promise<ParsedWebhookEvent>;

  /**
   * Consulta el estado actual de un pago por su referencia interna del proveedor.
   */
  getPaymentStatus(providerReference: string): Promise<PaymentStatusResult>;
}
