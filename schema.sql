-- 暗淵征討 Ashen Depths — D1 schema
-- Run once against your D1 database before deploying:
--   npx wrangler d1 execute ashen-depths-db --remote --file=./schema.sql
--
-- If you already deployed the v1 schema (players table with just
-- id/data/updated_at), run migration.sql instead to upgrade in place.

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT '無名英雄',
  best_stage INTEGER NOT NULL DEFAULT 0,
  best_gold INTEGER NOT NULL DEFAULT 0,
  flagged INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_players_best_stage ON players(best_stage DESC);
