import { PaymentProviderAdapter } from './PaymentProviderAdapter';
import { NaveAdapter } from './NaveAdapter';

/**
 * Registro de adaptadores de pasarela disponibles.
 * Para agregar un nuevo proveedor:
 * 1. Implementar la interfaz PaymentProviderAdapter
 * 2. Registrarlo aquí con su clave identificadora
 */
const adapters: Record<string, PaymentProviderAdapter> = {
  nave: new NaveAdapter(),
};

export function getPaymentAdapter(provider: string): PaymentProviderAdapter {
  const adapter = adapters[provider.toLowerCase()];
  if (!adapter) {
    throw new Error(`Payment provider '${provider}' not supported. Available: ${Object.keys(adapters).join(', ')}`);
  }
  return adapter;
}

export function getDefaultAdapter(): PaymentProviderAdapter {
  return adapters['nave'];
}

export { PaymentProviderAdapter, NaveAdapter };
