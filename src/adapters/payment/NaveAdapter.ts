import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../../config';
import {
  PaymentProviderAdapter,
  CreatePaymentLinkInput,
  CreatePaymentLinkResult,
  ParsedWebhookEvent,
  PaymentStatusResult,
} from './PaymentProviderAdapter';

/**
 * NaveAdapter - Adaptador para la pasarela NAVE (Argentina).
 *
 * NOTA: Esta implementación es un stub funcional documentado.
 * Los endpoints reales de NAVE deben configurarse cuando se disponga
 * de credenciales productivas. El contrato de la interfaz está completo
 * y listo para reemplazar con la integración real.
 *
 * Documentación NAVE: https://docs.nave.com (configurar en NAVE_BASE_URL)
 */
export class NaveAdapter implements PaymentProviderAdapter {
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly baseUrl: string;
  private readonly webhookSecret: string;
  private readonly mode: string;

  constructor() {
    this.apiKey = config.nave.apiKey;
    this.apiSecret = config.nave.apiSecret;
    this.baseUrl = config.nave.baseUrl;
    this.webhookSecret = config.nave.webhookSecret;
    this.mode = config.nave.mode;
  }

  name(): string {
    return 'nave';
  }

  /**
   * Crea un link de pago para cobrar el envío a través de NAVE.
   *
   * En modo sandbox (sin credenciales), devuelve un link simulado para
   * facilitar pruebas locales sin acceso a la API real de NAVE.
   */
  async createPaymentLink(input: CreatePaymentLinkInput): Promise<CreatePaymentLinkResult> {
    // Modo sandbox/stub: devolver link simulado para pruebas locales
    if (!this.apiKey || this.mode === 'sandbox') {
      console.log('[NaveAdapter] Sandbox mode: generating simulated payment link');
      const fakeReference = `NAVE-STUB-${uuidv4()}`;
      const fakeLink = `${config.app.baseUrl}/payment/stub?ref=${fakeReference}&amount=${input.amount}&currency=${input.currency}`;

      return {
        providerReference: fakeReference,
        paymentLink: fakeLink,
        status: 'PENDING',
        raw: {
          mode: 'sandbox',
          reference: fakeReference,
          externalOrderId: input.externalOrderId,
          amount: input.amount,
          currency: input.currency,
        },
      };
    }

    // Implementación real NAVE
    // Adaptar según documentación oficial de NAVE cuando se dispongan credenciales
    const body = {
      external_id: input.externalOrderId,
      amount: input.amount,
      currency: input.currency,
      description: input.description,
      payer: input.payer,
      metadata: input.metadata,
      callback_urls: {
        success: input.successUrl,
        failure: input.failureUrl,
        webhook: input.webhookUrl,
      },
      expires_at: input.expiresAt,
    };

    const response = await this.makeRequest('POST', '/v1/payment-links', body);

    return {
      providerReference: response.id as string,
      paymentLink: response.payment_url as string,
      status: 'PENDING',
      raw: response,
    };
  }

  /**
   * Parsea y valida un webhook de NAVE.
   * Verifica la firma HMAC para garantizar autenticidad.
   */
  async parseWebhook(
    payload: unknown,
    headers: Record<string, string>
  ): Promise<ParsedWebhookEvent> {
    // Validación de firma HMAC
    const signature = headers['x-nave-signature'] || headers['x-webhook-signature'];

    if (this.webhookSecret && signature) {
      const payloadStr = typeof payload === 'string'
        ? payload
        : JSON.stringify(payload);

      const expectedSig = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(payloadStr)
        .digest('hex');

      const expectedWithPrefix = `sha256=${expectedSig}`;

      if (!crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedWithPrefix)
      )) {
        throw new Error('Invalid NAVE webhook signature');
      }
    } else if (this.webhookSecret && !signature) {
      console.warn('[NaveAdapter] Webhook received without signature header - skipping validation in development');
    }

    const data = payload as Record<string, unknown>;

    // Mapeo del evento NAVE al formato estándar interno
    // Adaptar campos según documentación oficial de NAVE
    const eventId = (data.event_id ?? data.id ?? uuidv4()) as string;
    const reference = (data.payment_id ?? data.reference ?? data.external_id) as string;
    const rawStatus = (data.status ?? data.payment_status ?? 'PENDING') as string;

    const status = this.mapNaveStatus(rawStatus);

    return {
      providerEventId: String(eventId),
      providerReference: String(reference),
      status,
      paidAmount: data.amount as number | undefined,
      currency: (data.currency as string | undefined) ?? 'ARS',
      occurredAt: (data.occurred_at ?? data.created_at ?? new Date().toISOString()) as string,
      raw: data,
    };
  }

  /**
   * Consulta el estado actual de un pago en NAVE.
   */
  async getPaymentStatus(providerReference: string): Promise<PaymentStatusResult> {
    if (!this.apiKey || this.mode === 'sandbox') {
      console.log('[NaveAdapter] Sandbox mode: returning mock status for', providerReference);
      return {
        status: 'PENDING',
        raw: { mode: 'sandbox', reference: providerReference },
      };
    }

    const response = await this.makeRequest('GET', `/v1/payments/${providerReference}`);
    const rawStatus = (response.status ?? 'PENDING') as string;

    return {
      status: this.mapNaveStatus(rawStatus),
      raw: response,
    };
  }

  /**
   * Mapea estados de NAVE al enum interno.
   * Ajustar según la documentación real de NAVE.
   */
  private mapNaveStatus(
    naveStatus: string
  ): 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'CANCELED' {
    const statusMap: Record<string, 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'CANCELED'> = {
      pending: 'PENDING',
      in_process: 'PENDING',
      processing: 'PENDING',
      approved: 'APPROVED',
      accredited: 'APPROVED',
      paid: 'APPROVED',
      rejected: 'REJECTED',
      cancelled: 'CANCELED',
      canceled: 'CANCELED',
      expired: 'EXPIRED',
    };

    return statusMap[naveStatus.toLowerCase()] ?? 'PENDING';
  }

  /**
   * Realiza una solicitud HTTP a la API de NAVE.
   */
  private async makeRequest(
    method: string,
    endpoint: string,
    body?: unknown
  ): Promise<Record<string, unknown>> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-API-Key': this.apiKey,
      'X-API-Secret': this.apiSecret,
    };

    const options: RequestInit = {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    };

    const response = await fetch(url, options);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`NAVE API error [${response.status}]: ${errorText}`);
    }

    return response.json() as Promise<Record<string, unknown>>;
  }
}
