-- CreateTable
CREATE TABLE "category" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "display_order" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_item" (
    "id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "japanese_name" VARCHAR(120),
    "description" TEXT NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'MXN',
    "photo_path" VARCHAR(255),
    "display_order" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "allergens_reviewed" BOOLEAN NOT NULL DEFAULT false,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "available_updated_at" TIMESTAMPTZ(6),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "menu_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allergen" (
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(80) NOT NULL,

    CONSTRAINT "allergen_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "menu_item_allergen" (
    "menu_item_id" UUID NOT NULL,
    "allergen_code" VARCHAR(30) NOT NULL,

    CONSTRAINT "menu_item_allergen_pkey" PRIMARY KEY ("menu_item_id","allergen_code")
);

-- CreateTable
CREATE TABLE "outbox_event" (
    "seq" BIGSERIAL NOT NULL,
    "id" UUID NOT NULL,
    "type" VARCHAR(80) NOT NULL,
    "routing_key" VARCHAR(120) NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "correlation_id" UUID NOT NULL,
    "causation_id" UUID,
    "version" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "published_at" TIMESTAMPTZ(6),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,

    CONSTRAINT "outbox_event_pkey" PRIMARY KEY ("seq")
);

-- CreateTable
CREATE TABLE "processed_message" (
    "message_id" UUID NOT NULL,
    "consumer" VARCHAR(80) NOT NULL,
    "processed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_message_pkey" PRIMARY KEY ("message_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "category_slug_key" ON "category"("slug");

-- CreateIndex
CREATE INDEX "menu_item_category_id_idx" ON "menu_item"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_event_id_key" ON "outbox_event"("id");

-- Reglas de dominio que Prisma no puede expresar en el schema
CREATE UNIQUE INDEX "category_name_lower_key" ON "category" (lower("name"));
CREATE UNIQUE INDEX "menu_item_category_name_lower_key" ON "menu_item" ("category_id", lower("name"));
CREATE INDEX "outbox_event_unpublished_idx" ON "outbox_event" ("seq") WHERE "published_at" IS NULL;

ALTER TABLE "menu_item" ADD CONSTRAINT "menu_item_price_cents_positive" CHECK ("price_cents" > 0);
ALTER TABLE "menu_item" ADD CONSTRAINT "menu_item_revision_positive" CHECK ("revision" > 0);
ALTER TABLE "menu_item" ADD CONSTRAINT "menu_item_name_length" CHECK (char_length(btrim("name")) BETWEEN 2 AND 120);
ALTER TABLE "menu_item" ADD CONSTRAINT "menu_item_currency_length" CHECK (char_length("currency") = 3);

-- AddForeignKey
ALTER TABLE "menu_item" ADD CONSTRAINT "menu_item_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_item_allergen" ADD CONSTRAINT "menu_item_allergen_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_item_allergen" ADD CONSTRAINT "menu_item_allergen_allergen_code_fkey" FOREIGN KEY ("allergen_code") REFERENCES "allergen"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
