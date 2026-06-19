-- Migration 001: Initial schema
-- Entidades mínimas para pago de envío diferido

-- Tabla de tiendas (stores)
CREATE TABLE IF NOT EXISTS stores (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nube_store_id VARCHAR(64) UNIQUE NOT NULL,
  access_token  TEXT NOT NULL,
  store_name    VARCHAR(255),
  store_email   VARCHAR(255),
  status        VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tabla de pedidos vinculados (order_bridge)
CREATE TABLE IF NOT EXISTS order_bridge (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  nube_order_id   BIGINT NOT NULL,
  order_number    VARCHAR(64),
  currency        VARCHAR(8) NOT NULL DEFAULT 'ARS',
  products_total  NUMERIC(12,2) NOT NULL DEFAULT 0,
  shipping_mode   VARCHAR(64),
  status          VARCHAR(64) NOT NULL DEFAULT 'CREATED',
  raw_payload     JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, nube_order_id)
);

-- Índice para búsquedas por estado
CREATE INDEX IF NOT EXISTS idx_order_bridge_status ON order_bridge(status);
CREATE INDEX IF NOT EXISTS idx_order_bridge_store_id ON order_bridge(store_id);

-- Tabla de snapshot de cotización de envío
CREATE TABLE IF NOT EXISTS shipping_quote_snapshot (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_bridge_id  UUID NOT NULL REFERENCES order_bridge(id) ON DELETE CASCADE,
  quoted_amount    NUMERIC(12,2) NOT NULL,
  quoted_currency  VARCHAR(8) NOT NULL DEFAULT 'ARS',
  quote_source     VARCHAR(64),
  quote_metadata   JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice para búsquedas por order_bridge
CREATE INDEX IF NOT EXISTS idx_shipping_quote_order ON shipping_quote_snapshot(order_bridge_id);

-- Tabla de cobros de envío
CREATE TABLE IF NOT EXISTS shipping_charge (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_bridge_id   UUID NOT NULL REFERENCES order_bridge(id) ON DELETE CASCADE,
  amount            NUMERIC(12,2) NOT NULL,
  currency          VARCHAR(8) NOT NULL DEFAULT 'ARS',
  provider          VARCHAR(64) NOT NULL,
  provider_reference VARCHAR(255),
  payment_link      TEXT,
  status            VARCHAR(64) NOT NULL DEFAULT 'INITIATED',
  attempts          INTEGER NOT NULL DEFAULT 0,
  due_date          TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para shipping_charge
CREATE INDEX IF NOT EXISTS idx_shipping_charge_order ON shipping_charge(order_bridge_id);
CREATE INDEX IF NOT EXISTS idx_shipping_charge_status ON shipping_charge(status);
CREATE INDEX IF NOT EXISTS idx_shipping_charge_provider_ref ON shipping_charge(provider_reference);

-- Tabla de transacciones de pago
CREATE TABLE IF NOT EXISTS payment_transaction (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipping_charge_id UUID NOT NULL REFERENCES shipping_charge(id) ON DELETE CASCADE,
  provider_event_id VARCHAR(255) UNIQUE NOT NULL,
  event_type        VARCHAR(64) NOT NULL,
  status            VARCHAR(64),
  paid_amount       NUMERIC(12,2),
  currency          VARCHAR(8),
  raw_payload       JSONB,
  processed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para payment_transaction
CREATE INDEX IF NOT EXISTS idx_payment_tx_charge ON payment_transaction(shipping_charge_id);
CREATE INDEX IF NOT EXISTS idx_payment_tx_event_id ON payment_transaction(provider_event_id);
