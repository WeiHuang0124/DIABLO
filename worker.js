// 暗淵征討 Ashen Depths — Cloudflare Worker
// Serves the static game client and a small save/load/leaderboard API
// backed by D1, with a lightweight server-side sanity check on saves.
//
// Routes:
//   GET  /api/load?playerId=xxx        -> { ok, data, updatedAt }
//   POST /api/save  { playerId, name, data }
//                                       -> { ok, flagged }
//   GET  /api/leaderboard[?limit=20]   -> { ok, entries:[{id,name,bestStage,bestGold,updatedAt}] }
//   *    everything else               -> static assets (public/)
//
// ---------------------------------------------------------------
// ANTI-CHEAT — what this actually is (and isn't)
// ---------------------------------------------------------------
// The client still computes combat locally in real time (it's an idle
// game — there's no server tick loop). What the server *can* do without
// a full rearchitecture is bound how much progress is physically
// possible between two saves, using wall-clock time elapsed since the
// player's last save. If an incoming save claims more stage/level/gold
// growth than the game's own numbers allow for that time window (even
// generously, assuming max speed + non-stop play), the server clamps
// the save back down to the plausible ceiling and flags it, instead of
// trusting the client blindly. This stops naive "edit localStorage /
// replay a bigger number" cheating. It does NOT stop someone running a
// modified client that paces itself under the limit — that needs the
// combat simulation itself to move server-side, which is a bigger
// project (see README).

const MAX_ID_LEN = 200;
const MAX_NAME_LEN = 24;
const MAX_DATA_LEN = 200_000; // ~200KB safety cap per save

// Generous upper bounds — tuned to be well above what a legitimate
// player could ever reach, even at speed x4 with nonstop manual
// clicking, so real players are never falsely clamped.
const MAX_STAGE_PER_SEC = 2.2;
const MAX_LEVEL_PER_STAGE = 1.3;
const MAX_GOLD_PER_STAGE = 90;
const GRACE_STAGE = 8;   // small constant buffer on top of the rate limit
const GRACE_LEVEL = 4;
const GRACE_GOLD = 200;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/save" && request.method === "POST") {
      return handleSave(request, env);
    }
    if (url.pathname === "/api/load" && request.method === "GET") {
      return handleLoad(url, env);
    }
    if (url.pathname === "/api/leaderboard" && request.method === "GET") {
      return handleLeaderboard(url, env);
    }
    if (url.pathname.startsWith("/api/")) {
      return json({ ok: false, error: "not found" }, 404);
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleSave(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, error: "invalid json body" }, 400);
  }

  const playerId = String(body.playerId || "");
  const name = String(body.name || "無名英雄").slice(0, MAX_NAME_LEN);
  const dataStr = String(body.data ?? "");

  if (!playerId || playerId.length > MAX_ID_LEN) {
    return json({ ok: false, error: "invalid playerId" }, 400);
  }
  if (dataStr.length > MAX_DATA_LEN) {
    return json({ ok: false, error: "save payload too large" }, 400);
  }

  // Empty data string = "clear this save" (used by the reset button).
  if (dataStr === "") {
    await env.DB.prepare("DELETE FROM players WHERE id = ?").bind(playerId).run();
    return json({ ok: true, cleared: true });
  }

  let incoming;
  try {
    incoming = JSON.parse(dataStr);
  } catch (e) {
    return json({ ok: false, error: "data is not valid json" }, 400);
  }

  const prevRow = await env.DB.prepare(
    "SELECT data, updated_at, best_stage, best_gold FROM players WHERE id = ?"
  ).bind(playerId).first();

  let flagged = false;

  if (prevRow) {
    let prev;
    try { prev = JSON.parse(prevRow.data); } catch (e) { prev = null; }

    if (prev) {
      const elapsedSec = Math.max(1, (Date.now() - prevRow.updated_at) / 1000);
      const maxStageGain = Math.ceil(elapsedSec * MAX_STAGE_PER_SEC) + GRACE_STAGE;
      const maxLevelGain = Math.ceil(maxStageGain * MAX_LEVEL_PER_STAGE) + GRACE_LEVEL;
      const maxGoldGain = Math.ceil(maxStageGain * MAX_GOLD_PER_STAGE) + GRACE_GOLD;

      const stageGain = (incoming.stage || 0) - (prev.stage || 0);
      const levelGain = (incoming.level || 0) - (prev.level || 0);
      const goldGain = (incoming.gold || 0) - (prev.gold || 0); // gold can drop (death penalty) — only cap upside

      if (stageGain > maxStageGain || levelGain > maxLevelGain || goldGain > maxGoldGain) {
        flagged = true;
        incoming.stage = Math.min(incoming.stage || 0, (prev.stage || 0) + maxStageGain);
        incoming.level = Math.min(incoming.level || 0, (prev.level || 0) + maxLevelGain);
        incoming.gold = Math.min(incoming.gold || 0, (prev.gold || 0) + maxGoldGain);
      }
    }
  }

  const finalDataStr = flagged ? JSON.stringify(incoming) : dataStr;
  const prevBestStage = prevRow ? (prevRow.best_stage || 0) : 0;
  const prevBestGold = prevRow ? (prevRow.best_gold || 0) : 0;
  const bestStage = Math.max(prevBestStage, incoming.stage || 0);
  const bestGold = Math.max(prevBestGold, incoming.gold || 0);

  try {
    await env.DB.prepare(
      `INSERT INTO players (id, data, updated_at, name, best_stage, best_gold, flagged)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(id) DO UPDATE SET
         data = excluded.data,
         updated_at = excluded.updated_at,
         name = excluded.name,
         best_stage = excluded.best_stage,
         best_gold = excluded.best_gold,
         flagged = excluded.flagged`
    ).bind(playerId, finalDataStr, Date.now(), name, bestStage, bestGold, flagged ? 1 : 0).run();
    return json({ ok: true, flagged });
  } catch (e) {
    return json({ ok: false, error: "db error: " + String(e) }, 500);
  }
}

async function handleLoad(url, env) {
  const playerId = url.searchParams.get("playerId") || "";
  if (!playerId || playerId.length > MAX_ID_LEN) {
    return json({ ok: false, error: "invalid playerId" }, 400);
  }
  try {
    const row = await env.DB.prepare(
      "SELECT data, updated_at, name FROM players WHERE id = ?"
    ).bind(playerId).first();
    if (!row) return json({ ok: true, data: null });
    return json({ ok: true, data: row.data, updatedAt: row.updated_at, name: row.name });
  } catch (e) {
    return json({ ok: false, error: "db error: " + String(e) }, 500);
  }
}

async function handleLeaderboard(url, env) {
  const limitRaw = parseInt(url.searchParams.get("limit") || "20", 10);
  const limit = Math.min(50, Math.max(1, isNaN(limitRaw) ? 20 : limitRaw));
  try {
    const res = await env.DB.prepare(
      "SELECT id, name, best_stage, best_gold, updated_at FROM players ORDER BY best_stage DESC, best_gold DESC LIMIT ?"
    ).bind(limit).all();
    const entries = (res.results || []).map(r => ({
      id: r.id, name: r.name, bestStage: r.best_stage, bestGold: r.best_gold, updatedAt: r.updated_at
    }));
    return json({ ok: true, entries });
  } catch (e) {
    return json({ ok: false, error: "db error: " + String(e) }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
