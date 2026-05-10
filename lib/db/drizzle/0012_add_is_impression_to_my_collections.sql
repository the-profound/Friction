ALTER TABLE "my_collections" ADD COLUMN "is_impression" boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "my_collections_owner_impression_unique" ON "my_collections" USING btree ("owner_id") WHERE "my_collections"."is_impression" = true;
