# Checklist de etapa B — modo integrado

Estado: **borrador**. Este documento lista lo que debe cumplirse para pasar de la etapa A
(`APP_MODE=standalone`, `AUTH_MODE=dev`, `DEV_TOOLS_ENABLED=true`, contratos provisionales)
a la etapa B (`APP_MODE=integrated`, JWT real de Identity, Inventory real, sin simuladores).

Leyenda:

- ✅ **Verificable ahora**: se puede comprobar con el código actual y simuladores.
- ⏳ **Pendiente interno**: depende de Menu (código, operación o configuración propia).
- 🔒 **Bloqueado externo**: depende de Identity, Inventory o infraestructura del portafolio.

## 1. Identity (autenticación)

- [ ] 🔒 `AUTH_MODE=jwt` con clave pública emitida por Identity. Hoy se acepta
      `JWT_PUBLIC_KEY` o `JWT_PUBLIC_KEY_FILE`; falta confirmar cuál usará el despliegue.
- [ ] 🔒 Confirmar `iss` y `aud` (y si se validan). Hoy D-37 no los valida.
- [ ] 🔒 Confirmar claim de roles (`roles` vs `realm_access.roles`) y valores exactos
      (`admin`, `viewer`, etc.).
- [ ] 🔒 Definir distribución/rotación de claves; evaluar JWKS (hoy diferido).
- [ ] ⏳ Retirar los tokens fijos de desarrollo y `scripts/dev-jwt.cjs` del flujo real
      (el script puede quedarse para pruebas locales).
- [ ] ✅ Confirmar 401 sin token / token inválido / expirado y 403 sin rol. Cubierto por
      `test/integration/hito3-auth.test.ts`.

## 2. Inventory (disponibilidad)

- [ ] 🔒 Confirmar exchange (`hachi.events`, topic), routing key
      (`inventory.menu-item-availability-changed`), `source`, `type` y `version`.
- [ ] 🔒 Confirmar payload final (`menuItemId`, `available`) y campos adicionales.
- [ ] 🔒 Aceptar la semántica de `occurredAt` (momento del hecho) y del descarte de
      eventos viejos (`occurredAt <= available_updated_at`).
- [ ] 🔒 Confirmar idempotencia por `messageId` ante reintentos del productor.
- [ ] ⏳ Retirar el simulador `scripts/dev-inventory-publisher.cjs` del entorno integrado
      (puede quedarse para pruebas locales).
- [ ] ✅ Confirmar que la disponibilidad no sube `revision` ni publica eventos. Cubierto
      por `test/integration/hito3-messaging.test.ts`.

## 3. Mensajería y broker

- [ ] 🔒 Broker RabbitMQ gestionado: URL, credenciales por secreto y vhost.
- [ ] 🔒 Confirmar topología y nombres definitivos (D-34): `hachi.events`, `hachi.dlx`,
      `hachi.retry`, `menu.inventory-events`, DLQ.
- [ ] ⏳ Definir política de TTL de reintento para producción (`RABBITMQ_RETRY_TTLS_MS`).
- [ ] ⏳ Decidir relay mono-instancia vs bloqueo/particionado (D-46) antes de escalar.
- [ ] ⏳ Monitoreo y alerta de la DLQ; runbook de replay (hoy no existe herramienta).
- [ ] ✅ Confirmar publicación con publisher confirms, orden por `seq` y `published_at`.
      Cubierto por la prueba de integración del relay.

## 4. Datos

- [ ] 🔒 PostgreSQL gestionado (URL, credenciales, TLS, pool).
- [ ] ⏳ Migraciones con `pnpm db:deploy` (`prisma migrate deploy`) en el pipeline de
      despliegue; sin `migrate dev` fuera de local.
- [ ] ⏳ Backups y política de retención.
- [ ] ⏳ Definir estrategia de drenado del Outbox antes de desplegar (no debe quedar
      pendiente entre versiones incompatibles).

## 5. Configuración y secretos

- [ ] ✅ `APP_MODE=integrated` exige `AUTH_MODE=jwt` y `DEV_TOOLS_ENABLED=false`.
      Validado por `src/config/env.schema.ts`.
- [ ] ⏳ Gestión de secretos (JWT, DB, RabbitMQ) fuera del repositorio.
- [ ] ⏳ `PUBLIC_BASE_URL` real y URLs de fotos/media correctas detrás del proxy.
- [ ] ⏳ TLS de extremo a extremo y CORS si aplica.
- [ ] ⏳ Almacenamiento de fotos: hoy disco local (`PhotoStoragePort`); evaluar volumen
      persistente u object storage.

## 6. Observabilidad y operación

- [ ] ⏳ Métricas del relay y del consumidor (pendientes, latencia, reintentos, DLQ).
- [ ] ⏳ Trazas distribuidas y `correlationId` propagado a Identity/Inventory.
- [ ] ⏳ Alertas por crecimiento de la DLQ y por Outbox atascado.
- [ ] ✅ `/health` comprueba PostgreSQL y no exige RabbitMQ (D-40).

## 7. Pruebas y gates

- [ ] ⏳ CI en verde: `typecheck`, unitarias, integración y build (`.github/workflows/ci.yml`).
- [ ] ✅ Pruebas de integración con Testcontainers (relay, consumidor, reintentos, DLQ,
      JWT, 404 de tools). Ver `pnpm test:integration`.
- [ ] 🔒 Pruebas de contrato contra los productores/consumidores reales de
      `event-contracts`.
- [ ] ⏳ Prueba de humo en el entorno integrado (`scripts/smoke-messaging.sh` adaptado).

## 8. Despliegue y rollback

- [ ] ⏳ Despliegue canario y criterio de promoción.
- [ ] ⏳ Plan de rollback (versión anterior compatible con el esquema y los eventos).
- [ ] ⏳ Ventana de observación post-despliegue con la DLQ y el Outbox vigilados.

## Gates de salida (resumen)

1. CI verde en `main`.
2. Contratos de Inventory e Identity confirmados y pruebas de contrato en verde.
3. `APP_MODE=integrated` con JWT real y herramientas `dev` devolviendo 404.
4. DLQ con monitoreo y runbook; decisión de relay mono-instancia tomada.
5. Migraciones y backups operativos.
