# Contratos de eventos (Hito 3)

Esta carpeta contiene los esquemas JSON versionados y ejemplos usados por el validador
AJV en tiempo de ejecución (`src/events/contract-validator.ts`).

## Estado

| Contrato | Rol de Menu | Estado | Notas |
|---|---|---|---|
| `menu-item-updated.v1.schema.json` | Productor | **Estable para la etapa A** | Menu ya emite `MenuItemUpdated` en `hachi.events`; falta la confirmación formal de los consumidores. |
| `menu-item-availability-changed.v1.schema.json` | Consumidor | **Provisional** | Inventory todavía no existe. El payload se asumió desde el documento de diseño. |
| `envelope.v1.schema.json` | Común | **Estable para la etapa A** | Sobre común: `messageId`, `type`, `version`, `occurredAt`, `source`, `correlationId`, `causationId`, `payload`. |

Los contratos se copian a la imagen Docker (`Dockerfile`) y se leen desde `contracts/`
relativo al directorio de trabajo.

## Checklist al integrar Inventory

Inventory es dueño de la disponibilidad y será el productor real de
`MenuItemAvailabilityChanged`. Antes de la etapa B hay que confirmar y, si aplica, ajustar
el esquema:

- [ ] Nombre y tipo del exchange (`hachi.events`, topic) y routing key
      (`inventory.menu-item-availability-changed`).
- [ ] Valores exactos de `source` (`inventory`), `type` y `version`.
- [ ] Campos obligatorios del payload: `menuItemId` (UUID) y `available` (booleano).
- [ ] Semántica de `occurredAt`: debe ser la hora del hecho, no la de publicación; Menu
      descarta eventos con `occurredAt` menor o igual a la última actualización aplicada.
- [ ] Clave de idempotencia: se usa `messageId`; confirmar que Inventory lo mantiene ante
      reintentos.
- [ ] Uso de `correlationId`/`causationId` para trazabilidad.
- [ ] Nombres y TTLs de la topología de reintentos y DLQ.
- [ ] Volumen esperado y política de descarte de mensajes viejos.

## Checklist al integrar Identity

- [ ] Emisor (`iss`) y audiencia (`aud`) esperados, hoy no validados por D-37.
- [ ] Nombre y tipo de los claims: `sub` obligatorio; roles en `roles` o
      `realm_access.roles`.
- [ ] Algoritmo (`RS256`) y distribución de la clave pública (configuración/archivo hoy,
      JWKS diferido).
- [ ] Rotación de claves y periodo de gracia.
- [ ] Códigos de error 401/403 esperados por los clientes.

## Herramientas de desarrollo

Mientras Inventory e Identity no existen, se usan simuladores locales:

```bash
# Publica MenuItemAvailabilityChanged al exchange real
pnpm dev:publish-availability -- --menu-item-id <uuid> --available false

# Genera claves RSA y firma un JWT compatible con AUTH_MODE=jwt
pnpm dev:jwt -- --roles admin
```

Los simuladores **no sustituyen** a los servicios reales: solo permiten ejercitar el
consumidor, la validación de contratos y el guard JWT durante la etapa A. Las pruebas de
integración con Testcontainers (`pnpm test:integration`) arrancan PostgreSQL y RabbitMQ
reales para cubrir el relay, el consumidor, los reintentos, la DLQ y la autenticación.
