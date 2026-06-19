# pago-envio-diferido

Módulo para cobrar el costo de envío en una transacción separada del pago principal en tiendas **Tiendanube**, usando **NAVE** como primera pasarela de pago.

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│                     Cliente / Tienda                        │
│   (ve costo de envío cotizado en carrito, paga productos)   │
└──────────────────────┬──────────────────────────────────────┘
                       │ webhook order/created
                       ▼
┌─────────────────────────────────────────────────────────────┐
│             Backend pago-envio-diferido (Node.js + TS)      │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ OrderService │  │ShippingCharge│  │PaymentProvider   │  │
│  │              │  │Service       │  │Adapter (interfaz)│  │
│  └──────────────┘  └──────────────┘  └────────┬─────────┘  │
│                                               │             │
│                                     ┌─────────▼──────────┐  │
│                                     │   NaveAdapter      │  │
│                                     │  (stub funcional)  │  │
│                                     └────────────────────┘  │
└──────────────────────────────────────────────┬──────────────┘
                                               │
                                    ┌──────────▼──────────┐
                                    │    PostgreSQL DB     │
                                    └─────────────────────┘
```

### Flujo principal

```
1. order/created  →  Tiendanube envía webhook
2. Backend guarda order_bridge + shipping_quote_snapshot
3. POST /orders/:id/shipping-charge/create-link
4. NaveAdapter genera link de pago (solo envío)
5. shipping_charge queda en LINK_SENT
6. Cliente paga el link
7. NAVE envía webhook a /webhooks/payments/nave
8. Backend valida firma, registra payment_transaction (idempotente)
9. order_bridge → SHIPPING_PAID → READY_TO_SHIP
```

### Máquina de estados del pedido

```
CREATED
  ↓ (link generado)
SHIPPING_PAYMENT_PENDING
  ↓ (webhook pago aprobado)
SHIPPING_PAID
  ↓ (regla: pago envío aprobado)
READY_TO_SHIP

Cualquier estado → CANCELED
```

**Regla crítica:** No se puede pasar a `READY_TO_SHIP` sin que el cobro de envío esté en estado `APPROVED`.

---

## Variables de entorno

Copiar `.env.example` a `.env` y completar:

| Variable | Descripción | Requerido |
|---|---|---|
| `PORT` | Puerto del servidor | No (default: 3000) |
| `NODE_ENV` | Entorno (`development`/`production`) | No |
| `DB_HOST` | Host de PostgreSQL | Sí |
| `DB_PORT` | Puerto de PostgreSQL | No (default: 5432) |
| `DB_NAME` | Nombre de la base de datos | Sí |
| `DB_USER` | Usuario de PostgreSQL | Sí |
| `DB_PASSWORD` | Contraseña de PostgreSQL | Sí |
| `TIENDANUBE_APP_ID` | App ID de Tiendanube | Producción |
| `TIENDANUBE_APP_SECRET` | App Secret de Tiendanube | Producción |
| `TIENDANUBE_WEBHOOK_SECRET` | Secreto para webhooks TN | Producción |
| `NAVE_API_KEY` | API Key de NAVE | Producción |
| `NAVE_API_SECRET` | API Secret de NAVE | Producción |
| `NAVE_WEBHOOK_SECRET` | Secreto para webhooks NAVE | Producción |
| `NAVE_BASE_URL` | URL base API NAVE | Sí |
| `NAVE_MODE` | `sandbox` o `production` | No (default: sandbox) |
| `APP_BASE_URL` | URL pública del servidor | Sí |
| `PAYMENT_SUCCESS_URL` | Redirección pago exitoso | No |
| `PAYMENT_FAILURE_URL` | Redirección pago fallido | No |

---

## Cómo ejecutar local con Docker

### Requisitos previos
- Docker Desktop o Docker Engine + Docker Compose

### 1. Clonar y configurar

```bash
git clone https://github.com/Rodogaby1985/pago-envio-diferido.git
cd pago-envio-diferido

cp .env.example .env
# Editar .env con tus valores (para pruebas locales, los defaults funcionan)
```

### 2. Levantar el stack

```bash
# Construir y levantar postgres + app
docker compose up -d

# Aplicar migraciones
docker compose run --rm migrate

# Ver logs
docker compose logs -f app
```

### 3. Verificar que funciona

```bash
curl http://localhost:3000/health
```

Respuesta esperada:
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "service": "pago-envio-diferido",
  "db": { "status": "ok" }
}
```

### 4. Detener

```bash
docker compose down
# Para borrar la base de datos también:
docker compose down -v
```

---

## Flujo de prueba end-to-end (curl)

### Paso 1: Simular webhook order/created de Tiendanube

```bash
curl -X POST http://localhost:3000/webhooks/tiendanube/order-created \
  -H "Content-Type: application/json" \
  -d '{
    "store_id": "12345",
    "event": "order/created",
    "id": 99001,
    "order": {
      "id": 99001,
      "number": "1001",
      "currency": "ARS",
      "total": "15000.00",
      "subtotal": "12000.00",
      "shipping": {
        "cost": "3000.00",
        "method": "nave"
      },
      "contact_email": "cliente@example.com"
    }
  }'
```

Respuesta:
```json
{
  "ok": true,
  "order_id": "uuid-del-pedido",
  "nube_order_id": 99001,
  "status": "CREATED"
}
```

### Paso 2: Crear link de pago de envío

```bash
ORDER_ID="uuid-del-pedido"  # Del paso anterior

curl -X POST http://localhost:3000/orders/$ORDER_ID/shipping-charge/create-link \
  -H "Content-Type: application/json" \
  -d '{ "provider": "nave" }'
```

Respuesta (modo sandbox):
```json
{
  "ok": true,
  "charge_id": "uuid-del-cobro",
  "payment_link": "http://localhost:3000/payment/stub?ref=NAVE-STUB-xxx&amount=3000&currency=ARS",
  "amount": 3000,
  "currency": "ARS",
  "provider": "nave",
  "status": "LINK_SENT",
  "due_date": "2024-01-03T12:00:00.000Z"
}
```

### Paso 3: Consultar estado del cobro

```bash
curl http://localhost:3000/orders/$ORDER_ID/shipping-charge/status
```

Respuesta:
```json
{
  "ok": true,
  "order_id": "uuid-del-pedido",
  "order_status": "SHIPPING_PAYMENT_PENDING",
  "nube_order_id": 99001,
  "shipping_quote": {
    "quoted_amount": 3000,
    "quoted_currency": "ARS"
  },
  "shipping_charge": {
    "id": "uuid-del-cobro",
    "status": "LINK_SENT",
    "amount": 3000,
    "currency": "ARS",
    "payment_link": "http://...",
    "provider": "nave",
    "due_date": "2024-01-03T12:00:00.000Z"
  }
}
```

### Paso 4: Simular webhook de pago aprobado de NAVE

```bash
CHARGE_ID="uuid-del-cobro"  # Del paso 2

curl -X POST http://localhost:3000/webhooks/payments/nave \
  -H "Content-Type: application/json" \
  -d '{
    "event_id": "evt_test_001",
    "payment_id": "NAVE-STUB-xxx",
    "status": "approved",
    "amount": 3000.00,
    "currency": "ARS",
    "occurred_at": "2024-01-01T13:00:00Z"
  }'
```

Respuesta:
```json
{
  "ok": true,
  "charge_id": "uuid-del-cobro",
  "charge_status": "APPROVED"
}
```

### Paso 5: Verificar que el pedido quedó READY_TO_SHIP

```bash
curl http://localhost:3000/orders/$ORDER_ID/shipping-charge/status
```

El `order_status` debería ser `READY_TO_SHIP`.

---

## Endpoints disponibles

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/health` | Health check con estado de DB |
| `POST` | `/webhooks/tiendanube/order-created` | Webhook de orden creada |
| `POST` | `/orders/:orderId/shipping-charge/create-link` | Crear link de pago de envío |
| `GET` | `/orders/:orderId/shipping-charge/status` | Estado del cobro de envío |
| `POST` | `/webhooks/payments/:provider` | Webhook de pago (ej: `nave`) |

---

## Agregar una nueva pasarela de pago

1. Crear `src/adapters/payment/MiPasarelAdapter.ts` implementando `PaymentProviderAdapter`
2. Registrar en `src/adapters/payment/index.ts`:
   ```ts
   adapters['mipasarela'] = new MiPasarelaAdapter();
   ```
3. Usar `provider: "mipasarela"` al crear el link de pago

---

## Notas de seguridad y pendientes para producción

### ⚠️ Antes de ir a producción

- [ ] **Tokens OAuth Tiendanube**: implementar flujo OAuth2 completo para obtener access tokens reales por tienda
- [ ] **Credenciales NAVE reales**: configurar `NAVE_API_KEY`, `NAVE_API_SECRET`, `NAVE_WEBHOOK_SECRET` y cambiar `NAVE_MODE=production`
- [ ] **Validación de firma webhooks**: activar `NAVE_WEBHOOK_SECRET` y `TIENDANUBE_WEBHOOK_SECRET` para verificar HMAC en todos los webhooks entrantes
- [ ] **Cifrado de tokens**: cifrar `access_token` en reposo en la tabla `stores` (usar AES-256-GCM)
- [ ] **HTTPS obligatorio**: usar HTTPS + certificado TLS válido en producción (ngrok/Caddy/nginx)
- [ ] **Rate limiting**: agregar limitador de requests en endpoints de webhooks
- [ ] **Alertas**: configurar alertas para cobros fallidos/expirados acumulados
- [ ] **Backfill/conciliación**: implementar proceso nocturno para reconciliar estados con NAVE
- [ ] **Reembolsos**: definir política y flujo para reembolso parcial (solo envío)

### Idempotencia

Los webhooks de pago implementan idempotencia usando `provider_event_id` único en `payment_transaction`. Un mismo evento nunca se procesa dos veces.

### Congelamiento de monto

El monto cobrado por envío es exactamente el valor del `shipping_quote_snapshot` al momento de crear el pedido, no el valor al momento del cobro.

---

## Estructura del proyecto

```
src/
├── config/          # Variables de entorno y configuración
├── db/
│   ├── client.ts    # Pool de conexión PostgreSQL
│   ├── migrate.ts   # Script de migraciones
│   └── migrations/  # Archivos SQL de migraciones
├── domain/
│   ├── entities.ts  # Tipos e interfaces del dominio
│   └── stateMachine.ts  # Reglas de transición de estados
├── adapters/
│   └── payment/
│       ├── PaymentProviderAdapter.ts  # Interfaz común
│       ├── NaveAdapter.ts             # Implementación NAVE
│       └── index.ts                  # Registro de adaptadores
├── services/
│   ├── OrderService.ts         # Lógica de pedidos
│   └── ShippingChargeService.ts # Lógica de cobros de envío
├── routes/
│   ├── health.ts
│   ├── webhooks/
│   │   ├── tiendanube.ts   # Webhook order/created
│   │   └── payments.ts     # Webhook pasarela de pago
│   └── orders/
│       └── shippingCharge.ts  # Endpoints de cobro
├── middleware/
│   └── errorHandler.ts
├── app.ts    # Express app
└── index.ts  # Entry point
```
