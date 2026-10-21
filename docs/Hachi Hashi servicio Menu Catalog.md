# Hachi Hashi: servicio Menu/Catalog

Oct 20, 2026 · @eric good game

## Resumen

Menu/Catalog es el servicio dueño del menú del restaurante: platillos, categorías, precios, alérgenos y fotos. Se construye en NestJS, con su propia base PostgreSQL y su propio repositorio. Este documento respeta lo fijado en «arquitectura general» y en «acuerdos y decisiones», y define lo que es propio del servicio: modelo de datos, API, contratos de eventos, puertos y pruebas.

Cubre la etapa A (servicio independiente) completa y deja la etapa B (integración) como cambio de configuración. No documenta otros servicios.

## 1. Responsabilidad y límites

**Menu es dueño de:**

- Platillos: nombre, descripción, precio, categoría, foto, orden de aparición y si están activos.
- Categorías del menú.
- El catálogo de alérgenos y la declaración de alérgenos de cada platillo.
- Un espejo de la disponibilidad que informa Inventory (`available`), para que el menú público muestre «agotado».

**Menu no hace:**

- Insumos, recetas, caducidad ni merma: son de Inventory, que referencia los platillos solo por ID.
- Decidir la disponibilidad: la informa Inventory y Menu solo la refleja.
- Pedidos, cobros ni historial de precios: Orders guarda su propia copia del precio al crear el pedido.
- Emitir tokens: valida JWT localmente; los emite Identity.
- Participar en las sagas: no envía ni recibe comandos. Solo publica un evento de dominio y consume otro.
- Llamadas REST a otros servicios: no tiene ninguna.

**Quién lo usa:** el sitio público en Next.js (lectura) y el panel Angular (administración), siempre por el gateway. Por eventos: Inventory, Orders y Forecast/Reports consumen `MenuItemUpdated`; Menu consume `MenuItemAvailabilityChanged` de Inventory.

**Tecnología:** NestJS, Prisma (ORM y migraciones, según la arquitectura), PostgreSQL propio, RabbitMQ con `amqplib`, OpenAPI con `@nestjs/swagger`.

**Fuera de alcance por ahora:**

- Variantes y opciones de platillo (tamaños, porciones, extras): cada platillo tiene un solo precio. Si Orders las necesita, se añade un modelo de variantes y se amplía el payload de `MenuItemUpdated`.
- Combos y menús degustación.
- Menús por horario, temporada o sucursal: hay un solo menú vigente.
- Descuentos, promociones e impuestos: el precio es el de lista.
- Traducciones completas: solo existe `japanese_name`, como texto de apoyo.
- Varias fotos por platillo.
- Administración del catálogo de alérgenos desde la API: se carga por semilla y por migración.

## 2. Modelo de datos

No hay llaves foráneas hacia otros servicios. Todos los IDs son UUID generados por el servicio.

**category**

| Columna | Tipo | Notas |
| --- | --- | --- |
| `id` | uuid PK |  |
| `name` | varchar(80) | único sin distinguir mayúsculas |
| `slug` | varchar(80) | único; se usa en URLs |
| `display_order` | int | orden en el menú |
| `active` | boolean | por defecto true |
| `created_at`, `updated_at` | timestamptz |  |

**menu\_item**

| Columna | Tipo | Notas |
| --- | --- | --- |
| `id` | uuid PK | inmutable; es el ID que usan los demás servicios |
| `category_id` | uuid FK a category | ON DELETE RESTRICT |
| `name` | varchar(120) |  |
| `japanese_name` | varchar(120) null | opcional, solo para mostrar |
| `description` | text |  |
| `price_cents` | integer | CHECK > 0; dinero en centavos, sin decimales flotantes |
| `currency` | char(3) | por defecto `MXN` |
| `photo_path` | varchar null | archivo en el almacenamiento de fotos |
| `display_order` | int |  |
| `active` | boolean | decisión del administrador; por defecto false (borrador) |
| `allergens_reviewed` | boolean | por defecto false; se vuelve true al declarar alérgenos |
| `available` | boolean | espejo de Inventory; por defecto true |
| `available_updated_at` | timestamptz null | `occurredAt` del último cambio de disponibilidad aplicado |
| `revision` | integer | empieza en 1; sube con cada cambio que se publica |
| `created_at`, `updated_at` | timestamptz |  |
| `updated_by` | uuid null | `sub` del JWT; referencia por ID, sin FK |

Restricción única: `(category_id, lower(name))`.

**allergen** y **menu\_item\_allergen**

| Tabla | Columnas | Notas |
| --- | --- | --- |
| `allergen` | `code` varchar(30) PK, `name` varchar(80) | catálogo cargado por semilla: gluten, crustáceos, moluscos, pescado, huevo, lácteos, soya, ajonjolí, cacahuate, frutos secos, sulfitos |
| `menu_item_allergen` | `menu_item_id` FK, `allergen_code` FK | PK compuesta |

**outbox\_event** (patrón Outbox)

| Columna | Tipo | Notas |
| --- | --- | --- |
| `seq` | bigserial | orden de publicación |
| `id` | uuid PK | será el `messageId` |
| `type`, `routing_key` | varchar | `MenuItemUpdated`, `menu.menu-item-updated` |
| `aggregate_id` | uuid | ID del platillo |
| `correlation_id`, `causation_id` | uuid | `causation_id` es null en los eventos de Menu |
| `version` | int | versión del contrato |
| `payload` | jsonb |  |
| `occurred_at` | timestamptz |  |
| `published_at` | timestamptz null | null mientras no se haya publicado; índice parcial sobre esos registros |
| `attempts`, `last_error` | int, text |  |

**processed\_message** (idempotencia del consumidor): `message_id` uuid PK, `consumer` varchar, `processed_at` timestamptz.

**Datos semilla.** Categorías (Entradas, Nigiri, Sashimi, Rolls, Ramen, Postres, Bebidas) y unos 30 platillos con alérgenos revisados. Los UUID de los platillos son deterministas y se publican en el repositorio de infraestructura, para que Inventory pueda sembrar recetas con los mismos IDs en la etapa A sin depender de Menu.

## 3. API

Base `/api/menu`, de modo que el gateway enruta por prefijo sin reescribir rutas. Swagger UI en `/api/docs`. Errores en formato `application/problem+json`. Los listados paginan con `page` y `size` (máximo 100).

**Públicos (sin autenticación)**

| Método y ruta | Descripción |
| --- | --- |
| `GET /api/menu` | Menú completo: categorías activas con sus platillos activos, `available`, alérgenos y foto |
| `GET /api/menu/categories` | Categorías activas |
| `GET /api/menu/items` | Platillos activos. Filtros: `categoryId`, `available`, `excludeAllergens` (códigos separados por coma) y `q` |
| `GET /api/menu/items/{id}` | Detalle de un platillo |
| `GET /api/menu/allergens` | Catálogo de alérgenos |
| `GET /api/menu/media/{file}` | Foto de un platillo |
| `GET /health` | Salud del servicio y de su base |

**Administración (rol administrador)**

| Método y ruta | Descripción |
| --- | --- |
| `GET /api/menu/admin/items` | Todos los platillos, incluidos borradores e inactivos |
| `POST /api/menu/admin/items` | Crea un platillo en estado borrador (`active` false, `revision` 1) |
| `PUT /api/menu/admin/items/{id}` | Edita nombre, descripción, precio, categoría y orden; exige `revision` |
| `PATCH /api/menu/admin/items/{id}/status` | Activa o desactiva; cuerpo `{ active, revision }` |
| `PUT /api/menu/admin/items/{id}/allergens` | Reemplaza la lista de alérgenos (puede ir vacía) y marca `allergens_reviewed` |
| `PUT /api/menu/admin/items/{id}/photo` | Sube la foto (multipart) |
| `DELETE /api/menu/admin/items/{id}/photo` | Quita la foto |
| `GET /api/menu/admin/categories` | Todas las categorías, incluidas inactivas |
| `POST /api/menu/admin/categories` | Crea una categoría |
| `PUT /api/menu/admin/categories/{id}` | Edita nombre y orden |
| `PATCH /api/menu/admin/categories/{id}/status` | Activa o desactiva |
| `DELETE /api/menu/admin/categories/{id}` | Borra una categoría que nunca tuvo platillos |

No existe `DELETE` de platillos: se desactivan (RN-05).

**Solo modo independiente**

| Método y ruta | Descripción |
| --- | --- |
| `PUT /api/menu/dev/items/{id}/availability` | Simula a Inventory: cuerpo `{ available, occurredAt? }`. No existe en modo integrado |

**Respuesta de un platillo (pública):** `id`, `name`, `japaneseName`, `description`, `priceCents`, `currency`, `category { id, name }`, `allergens` (códigos), `photoUrl`, `available`. La vista de administración añade `active`, `allergensReviewed` y `revision`.

**Códigos de error:** 400 validación, 401 sin token, 403 sin rol, 404 no existe, 409 conflicto (`revision` desactualizada, nombre duplicado, categoría con platillos), 422 regla de negocio (por ejemplo activar sin alérgenos revisados).

## 4. Eventos

Menu usa la envoltura común de la arquitectura general, con `source` igual a `menu`. Como no participa en sagas, el `correlationId` de sus eventos es el ID de la petición HTTP que provocó el cambio (se genera uno si el cliente no lo envía) y `causationId` va en null.

&#91;embedded content: eventos de Menu · 1 publicado, 1 consumido\]

Menu escribe `MenuItemUpdated` en el Outbox y lo publica por `hachi.events`; la disponibilidad solo entra desde Inventory, por una cola propia.

### 4.1 Publica: `MenuItemUpdated`

Exchange `hachi.events`, routing key `menu.menu-item-updated`, `version` 1. Consumen Inventory, Orders y Forecast/Reports, como indica el catálogo.

**Cuándo se publica**

- Al crear un platillo.
- Al cambiar su nombre, precio, categoría o `active`.
- Al renombrar una categoría: un evento por cada platillo de esa categoría, todos con el mismo `correlationId`.

**Payload.** Es una foto completa del estado del platillo, no un diferencial, para que el consumidor haga upsert.

| Campo | Tipo | Descripción |
| --- | --- | --- |
| `menuItemId` | uuid | ID del platillo |
| `revision` | integer | Crece con cada cambio publicado; el consumidor descarta eventos con `revision` menor o igual a la que ya tiene |
| `name` | string | Nombre del platillo |
| `priceCents` | integer | Precio en centavos |
| `currency` | string | Código ISO 4217, hoy `MXN` |
| `categoryId` | uuid | ID de la categoría |
| `categoryName` | string | Nombre de la categoría |
| `active` | boolean | Si el platillo está activo en el menú |

Ejemplo de mensaje completo:

```json
{
  "messageId": "7c1f0e52-3b8a-4f6e-9d2a-5a1b6c0d9e11",
  "type": "MenuItemUpdated",
  "version": 1,
  "occurredAt": "2026-10-20T18:42:10Z",
  "source": "menu",
  "correlationId": "0b6f2a9e-41c5-4c0e-8f3a-2d7e9b1a5c33",
  "causationId": null,
  "payload": {
    "menuItemId": "3f9a6d2e-8c14-4b7a-a5e0-91d2c7b84f10",
    "revision": 4,
    "name": "Nigiri de salmón",
    "priceCents": 18900,
    "currency": "MXN",
    "categoryId": "b2d4e6f8-1a3c-4e5b-9d7f-0c2a4e6b8d10",
    "categoryName": "Nigiri",
    "active": true
  }
}
```

**Qué no lleva.** Descripción, foto, alérgenos y orden de aparición no viajan en el evento: los consumidores no los necesitan y el contrato pide datos mínimos. Si algún servicio los requiere, se añaden como campos nuevos (cambio aditivo, sin subir `version`). Cambiarlos no sube `revision` ni publica evento.

**Uso previsto por los consumidores** (se confirma en el documento de cada uno): Orders toma nombre, precio y `active` para validar y fijar el precio de un pedido; Inventory valida con él los IDs de sus recetas; Forecast/Reports lo usa para nombres, precios y categorías en sus reportes.

**Publicación.** El evento se escribe en `outbox_event` dentro de la misma transacción que el cambio de datos. Un relay lo publica a RabbitMQ con confirmaciones del broker (publisher confirms), en orden de `seq`, y marca `published_at`. Si el broker falla, reintenta con espera creciente. Los eventos del mismo platillo salen en orden, pero los consumidores no deben depender de eso: usan `revision`.

### 4.2 Consume: `MenuItemAvailabilityChanged`

Lo publica Inventory cuando un platillo se agota o vuelve a estar disponible según sus insumos.

| Elemento | Valor |
| --- | --- |
| Cola | `menu.inventory-events` |
| Binding | `inventory.menu-item-availability-changed` sobre `hachi.events` |
| Dead-letter | `hachi.dlx`, cola `menu.inventory-events.dlq`, tras 3 reintentos |

**Payload mínimo que Menu necesita** (el contrato final es de Inventory y se define en su documento; Menu ignora los campos que no conozca):

| Campo | Tipo | Descripción |
| --- | --- | --- |
| `menuItemId` | uuid | Platillo afectado |
| `available` | boolean | Si quedó disponible o agotado |

El orden se decide con el `occurredAt` de la envoltura, porque no hay orden global entre mensajes.

**Procesamiento**

1. Si el `messageId` ya está en `processed_message`, se confirma el mensaje y no se hace nada.
2. Si el platillo no existe, se registra una advertencia y se confirma el mensaje; reintentar no lo arreglaría.
3. Si `occurredAt` es menor o igual a `available_updated_at`, el mensaje es viejo y se descarta.
4. Si no, se actualizan `available` y `available_updated_at` y se registra el `messageId`, todo en una transacción.
5. Un error transitorio reintenta hasta 3 veces con espera creciente y luego manda el mensaje a la cola de dead-letter.

### 4.3 Lo que Menu no publica, y por qué

- **Cambios de disponibilidad.** Es un espejo de lo que dice Inventory; republicarlo crearía un ciclo entre ambos servicios. Quien necesite la disponibilidad la escucha a Inventory.
- **Eventos de categorías.** Las categorías no tienen evento propio; sus cambios relevantes salen como `MenuItemUpdated` de cada platillo.

El servicio no necesita eventos nuevos ni cambios en el catálogo de la arquitectura general.

## 5. Puertos y adaptadores

La lógica de negocio solo conoce los puertos. Un módulo de NestJS elige el adaptador según `APP_MODE` y las banderas de la sección 7.

| Puerto | Función | Etapa A | Etapa B |
| --- | --- | --- | --- |
| `EventBusPort` | Publicar un mensaje al bus | `LoggingEventBus`: solo escribe en el log; se usa para probar el relay | `RabbitMqEventBus` con publisher confirms |
| `AvailabilityInboundPort` (caso de uso `ApplyAvailabilityChange`) | Recibir cambios de disponibilidad | `DevAvailabilityController`: simula a Inventory por HTTP | `RabbitMqAvailabilityConsumer` |
| `JwtKeyProviderPort` | Entregar la clave para validar JWT | `DevKeyProvider`: secreto de prueba o usuario fijo, solo con perfil `dev` | `ConfigKeyProvider`: clave pública por configuración; un adaptador `JwksKeyProvider` queda como alternativa si se decide usar el endpoint de Identity |
| `PhotoStoragePort` | Guardar y servir fotos | `LocalDiskPhotoStorage` sobre un volumen Docker | El mismo; un adaptador de object storage (MinIO o S3) es posible sin tocar el negocio |
| `ClockPort` | Obtener la hora actual | `SystemClock`; en pruebas, un reloj fijo | `SystemClock` |

El Outbox no es un adaptador: escribe siempre en su tabla. Lo que cambia entre etapas es si el relay lo publica.

## 6. Reglas de negocio

Las reglas se agrupan por su naturaleza, porque eso decide dónde se implementan. Se conserva la numeración RN-01 a RN-12.

### Invariantes

Condiciones que se cumplen siempre sobre el estado de los datos, sin importar cómo se llegó a él. Viven en el dominio y, donde el modelo lo permite, se refuerzan en la base (RN-01 y RN-02 ya tienen su restricción en la sección 2).

- **RN-01 Nombre.** Obligatorio, de 2 a 120 caracteres, único dentro de su categoría sin distinguir mayúsculas.
- **RN-02 Precio.** Entero mayor que 0 en centavos, con moneda `MXN`. Un cambio de precio solo afecta pedidos futuros; Menu no conoce los pedidos.
- **RN-03 Alérgenos revisados.** Un platillo nace como borrador inactivo. No puede activarse hasta que se declaren sus alérgenos con `PUT .../allergens`, aunque la lista quede vacía; así se distingue «sin alérgenos» de «sin capturar». Activar sin esa revisión devuelve 422.
- **RN-06 Categorías.** Una categoría inactiva no tiene platillos activos: solo se puede desactivar una categoría sin platillos activos, y solo borrarla si nunca tuvo platillos. En ambos casos, de lo contrario, devuelve 409.

### Reglas de proceso o transición

Qué debe ocurrir cuando algo cambia o llega. Se implementan en los casos de uso.

- **RN-05 Sin borrado de platillos.** Solo se desactivan, porque Orders, Inventory y Forecast/Reports guardan su ID en el historial.
- **RN-07 Cambios publicables.** Cambiar nombre, precio, categoría o `active` (o renombrar su categoría) sube `revision` y escribe el evento en el Outbox en la misma transacción. Si la transacción falla, no queda evento.
- **RN-08 Concurrencia.** Las ediciones exigen `revision`; si no coincide con la actual, 409.
- **RN-09 Disponibilidad.** Solo la modifica el consumidor de Inventory o, en modo independiente, el endpoint de desarrollo. Ningún endpoint de administración la escribe. Cambiarla no sube `revision` ni publica evento (sección 4.3).
- **RN-12 Idempotencia.** Todo mensaje consumido se procesa una sola vez por `messageId`.

### Regla derivada

Se calcula a partir del estado y no se almacena.

- **RN-04 Platillo pedible.** Un platillo se puede pedir cuando está `active`, `available` y su categoría está activa. El menú público muestra los platillos activos, y los no disponibles aparecen marcados como agotados en lugar de ocultarse.

### Políticas técnicas y de presentación

Restricciones de validación y de operación; no forman parte del dominio. Se aplican en la capa de entrada y en la configuración.

- **RN-10 Fotos.** Formatos JPEG, PNG o WebP, hasta 5 MB, una por platillo, con nombre generado por el servicio. Subir una nueva borra la anterior.
- **RN-11 Caché pública.** Las lecturas públicas devuelven `ETag` y `Cache-Control: public, max-age=60`, un plazo corto porque la disponibilidad cambia.

## 7. Configuración de los modos

El servicio pasa de independiente a integrado cambiando variables de entorno, sin tocar el código de negocio. `APP_MODE` fija los valores por defecto y cada bandera puede sobrescribirse.

| Variable | Etapa A: `standalone` | Etapa B: `integrated` |
| --- | --- | --- |
| `APP_MODE` | `standalone` | `integrated` |
| `DATABASE_URL` | PostgreSQL del propio compose | PostgreSQL propio del servicio en el compose global |
| `AUTH_MODE` | `dev`: acepta tokens de prueba o usuario fijo | `jwt`: valida con la clave pública de Identity |
| `JWT_PUBLIC_KEY` o `JWT_PUBLIC_KEY_FILE` | no se usa | clave pública de Identity |
| `OUTBOX_PUBLISH_ENABLED` | `false`: el Outbox escribe, el relay está apagado | `true` |
| `CONSUMERS_ENABLED` | `false` | `true` |
| `RABBITMQ_URL` | no se usa | cadena de conexión con las credenciales propias del servicio |
| `DEV_TOOLS_ENABLED` | `true`: expone el simulador de disponibilidad | `false` |
| `PHOTO_STORAGE_PATH` | volumen local | volumen local |
| `PUBLIC_BASE_URL` | URL directa del servicio | URL del gateway |
| `SEED_ON_START` | `true` | `false` |

Otros parámetros con valor por defecto: `OUTBOX_POLL_INTERVAL_MS` (1000), `OUTBOX_BATCH_SIZE` (50) y `CONSUMER_MAX_RETRIES` (3).

**Protecciones al arrancar.** El servicio se niega a iniciar si `APP_MODE` es `integrated` y `AUTH_MODE` es `dev`, o si `DEV_TOOLS_ENABLED` es `true`. También se niega si `OUTBOX_PUBLISH_ENABLED` o `CONSUMERS_ENABLED` está en `true` sin `RABBITMQ_URL`.

**Despliegue.** En la etapa A, el `docker-compose` del repositorio levanta `menu-api` y `menu-db` (PostgreSQL) con un volumen para las fotos, y nada más. Las migraciones corren con `prisma migrate deploy` al arrancar. En la etapa B, el `docker-compose` global del repositorio de infraestructura levanta el mismo contenedor junto con el gateway y RabbitMQ.

## 8. Estrategia de pruebas

Las pruebas forman parte de la etapa A y corren con `npm test`, sin depender de otros servicios. La integración continua llega en la etapa D.

**Niveles**

- **Unitarias (Jest).** Reglas de dominio: RN-01 a RN-12, incluidos el cálculo de `revision`, la activación con alérgenos revisados y el descarte de disponibilidad vieja.
- **Integración con Testcontainers.** PostgreSQL real con las migraciones de Prisma y, para el relay y el consumidor, un contenedor RabbitMQ real.
- **API (supertest).** Cada endpoint sobre la base real, con roles y códigos de error.
- **Contrato.** Esquemas JSON de la envoltura y del payload de `MenuItemUpdated` en una carpeta `contracts/`; las pruebas validan contra ellos cada fila del Outbox. Para el mensaje consumido se guarda un ejemplo de `MenuItemAvailabilityChanged` que el consumidor debe poder procesar.

**Casos clave**

| Escenario | Resultado esperado |
| --- | --- |
| Crear, editar o activar un platillo | Una fila en el Outbox con `revision` correcta |
| Fallo a mitad de la transacción | Ni cambio de datos ni evento |
| Renombrar una categoría con N platillos | N eventos con el mismo `correlationId` |
| Activar sin alérgenos revisados | 422 |
| Editar con `revision` vieja | 409 |
| Mismo `messageId` entregado dos veces | Se procesa una sola vez |
| Disponibilidad con `occurredAt` anterior al aplicado | Se descarta |
| Disponibilidad de un ID desconocido | Se confirma y se registra advertencia |
| Lecturas públicas sin token; escrituras sin rol | 200 en lecturas; 401 o 403 en escrituras |
| Foto con formato o tamaño no válido | 400 |
| `OUTBOX_PUBLISH_ENABLED` en `false` | Eventos en el Outbox y nada publicado |
| Relay activo y broker caído, luego recuperado | Reintenta y publica en orden de `seq` |
| Integrado con autenticación `dev` | El servicio no arranca |

**Entregables de la etapa A:** OpenAPI publicada en Swagger, una colección Bruno con los flujos principales (crear platillo, revisar alérgenos, activar, simular disponibilidad) y un README con el comando único para levantar el servicio.

## Decisiones por confirmar

- [ ] Payload de `MenuItemAvailabilityChanged`: confirmar `menuItemId` y `available` al documentar Inventory.
- [ ] Moneda `MXN` y dinero como entero en centavos; conviene fijarlo como convención común de todos los servicios.
- [ ] Almacenamiento de fotos: disco local con volumen (propuesto) o object storage.
- [ ] Dónde se publican los UUID semilla de los platillos, para que Inventory los reutilice.
- [ ] Nombres de exchanges y colas: los usados aquí siguen los ejemplos de la arquitectura general y dependen de cerrar esa decisión.
- [ ] Cómo recibe Menu la clave pública de Identity: configuración (propuesto) o endpoint de claves.
