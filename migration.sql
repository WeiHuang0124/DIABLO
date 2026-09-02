-- Migration for people who already ran the original schema.sql and deployed.
-- Safe to run even if some columns already exist is NOT guaranteed by D1/SQLite
-- (ALTER TABLE ADD COLUMN fails if the column exists), so only run the lines
-- for columns you don't have yet. Fresh installs should just use schema.sql.
--
--   npx wrangler d1 execute ashen-depths-db --remote --file=./migration.sql

ALTER TABLE players ADD COLUMN name TEXT NOT NULL DEFAULT '無名英雄';
ALTER TABLE players ADD COLUMN best_stage INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN best_gold INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN flagged INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_players_best_stage ON players(best_stage DESC);
