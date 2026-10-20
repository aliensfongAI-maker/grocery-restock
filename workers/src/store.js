import {
  ERR_HOLD,
  ERR_NEW_TYPE,
  ERR_NOT_FOUND,
  ERR_RECLASS,
  MAX_AT,
  MAX_NAME,
  MAX_NOTE,
  MAX_SUBTYPE,
  MAX_TYPE,
  SEED_ROWS,
  clean,
  publicExclusion,
  publicHold,
  publicOverride,
  byAtDesc,
  byOverride,
} from "./logic.js";

function changesOf(result) {
  return result?.meta?.changes ?? 0;
}

const LATEST_HOLDS = `
  SELECT type, name, at, note, status
  FROM (
    SELECT type, name, at, note, status,
           ROW_NUMBER() OVER (PARTITION BY type, name ORDER BY at DESC, id DESC) AS rn
    FROM holds
  ) AS ranked
  WHERE rn = 1
`;

const LATEST_OVERRIDES = `
  SELECT old_type, name, new_type, new_subtype, at, note, status
  FROM (
    SELECT old_type, name, new_type, new_subtype, at, note, status,
           ROW_NUMBER() OVER (PARTITION BY old_type, name ORDER BY at DESC, id DESC) AS rn
    FROM overrides
  ) AS ranked
  WHERE rn = 1
`;

export async function readPublicPayload(db) {
  const excluded = await db
    .prepare(
      `SELECT type, name, at, note, status FROM exclusions WHERE status = 'excluded'`
    )
    .all();
  const held = await db
    .prepare(`${LATEST_HOLDS} AND status = 'held'`)
    .all();
  const active = await db
    .prepare(`${LATEST_OVERRIDES} AND status = 'active'`)
    .all();

  const items = excluded.results.map(publicExclusion).sort(byAtDesc);
  const heldRows = held.results.map(publicHold).sort(byAtDesc);
  const overrides = active.results.map(publicOverride).sort(byOverride);
  return { items, held: heldRows, overrides };
}

export async function applyExclude(db, { type, name, at, body }) {
  const hasNote = body.note != null;
  const note = hasNote ? clean(body.note, MAX_NOTE) : "";
  await db
    .prepare(
      `INSERT INTO exclusions (type, name, at, note, status)
       VALUES (?, ?, ?, ?, 'excluded')
       ON CONFLICT(type, name) DO UPDATE SET
         at = excluded.at,
         note = CASE WHEN ? = 1 THEN excluded.note ELSE exclusions.note END,
         status = 'excluded'`
    )
    .bind(type, name, at, note, hasNote ? 1 : 0)
    .run();
  return "";
}

export async function applyRestore(db, type, name) {
  const result = await db
    .prepare(
      `UPDATE exclusions SET status = 'restored'
       WHERE type = ? AND name = ? AND status = 'excluded'`
    )
    .bind(type, name)
    .run();
  return changesOf(result) === 0 ? ERR_NOT_FOUND : "";
}

export async function applyHold(db, { type, name, at, body }) {
  const hasNote = body.note != null;
  const note = hasNote ? clean(body.note, MAX_NOTE) : "";
  await db
    .prepare(
      `INSERT INTO holds (type, name, at, note, status)
       VALUES (
         ?, ?, ?,
         CASE
           WHEN ? = 1 THEN ?
           ELSE COALESCE(
             (SELECT note FROM holds WHERE type = ? AND name = ? ORDER BY at DESC, id DESC LIMIT 1),
             ''
           )
         END,
         'held'
       )`
    )
    .bind(type, name, at, hasNote ? 1 : 0, note, type, name)
    .run();
  return "";
}

export async function applyUnhold(db, type, name, at) {
  const result = await db
    .prepare(
      `INSERT INTO holds (type, name, at, note, status)
       SELECT type, name, ?, note, 'unheld'
       FROM (
         SELECT type, name, note, status
         FROM holds
         WHERE type = ? AND name = ?
         ORDER BY at DESC, id DESC
         LIMIT 1
       ) AS latest
       WHERE status = 'held'`
    )
    .bind(at, type, name)
    .run();
  return changesOf(result) === 0 ? ERR_HOLD : "";
}

export async function applyReclass(db, { type, name, at, body }) {
  const newType = clean(body.newType, MAX_TYPE);
  const newSubtype = clean(body.newSubtype, MAX_SUBTYPE);
  if (!newType) return { error: ERR_NEW_TYPE, webhook: null };
  const hasNote = body.note != null;
  const note = hasNote ? clean(body.note, MAX_NOTE) : "";
  await db
    .prepare(
      `INSERT INTO overrides (old_type, name, new_type, new_subtype, at, status, note)
       VALUES (
         ?, ?, ?, ?, ?, 'active',
         CASE
           WHEN ? = 1 THEN ?
           ELSE COALESCE(
             (SELECT note FROM overrides WHERE old_type = ? AND name = ? ORDER BY at DESC, id DESC LIMIT 1),
             ''
           )
         END
       )`
    )
    .bind(type, name, newType, newSubtype, at, hasNote ? 1 : 0, note, type, name)
    .run();
  return {
    error: "",
    webhook: {
      event: "reclass",
      type,
      name,
      newType,
      newSubtype,
      at,
    },
  };
}

export async function applyReclassClear(db, type, name, at) {
  const result = await db
    .prepare(
      `INSERT INTO overrides (old_type, name, new_type, new_subtype, at, status, note)
       SELECT old_type, name, new_type, new_subtype, ?, 'cleared', note
       FROM (
         SELECT old_type, name, new_type, new_subtype, note, status
         FROM overrides
         WHERE old_type = ? AND name = ?
         ORDER BY at DESC, id DESC
         LIMIT 1
       ) AS latest
       WHERE status = 'active'`
    )
    .bind(at, type, name)
    .run();
  return changesOf(result) === 0 ? ERR_RECLASS : "";
}

export async function seedOverrides(db, at) {
  const stmts = SEED_ROWS.map((row) =>
    db
      .prepare(
        `INSERT INTO overrides (old_type, name, new_type, new_subtype, at, status, note)
         SELECT ?, ?, ?, ?, ?, 'active', 'seed'
         WHERE NOT EXISTS (
           SELECT 1 FROM overrides
           WHERE old_type = ? AND name = ? AND status = 'active'
         )`
      )
      .bind(row.oldType, row.name, row.newType, row.newSubtype, at, row.oldType, row.name)
  );
  const results = await db.batch(stmts);
  return results.reduce((sum, result) => sum + changesOf(result), 0);
}

function keyOf(type, name) {
  return `${type}\n${name}`;
}

function snapshotAt(raw, fallback) {
  return clean(raw.at ?? raw.excludedAt, MAX_AT) || fallback;
}

/**
 * Import a GAS GET snapshot `{ items, held, overrides }`.
 * replace true makes that snapshot the whole public state (cutover).
 * replace false only upserts/appends the given keys.
 * Neither path calls the reclass webhook.
 */
export async function importSnapshot(db, body, at) {
  const items = Array.isArray(body.items) ? body.items : null;
  const held = Array.isArray(body.held) ? body.held : null;
  const overrides = Array.isArray(body.overrides) ? body.overrides : null;
  if (!items && !held && !overrides) {
    return { error: "需要 items、held 或 overrides" };
  }
  const replace = body.replace === true;
  const stmts = [];
  const imported = {
    exclusions: 0,
    holds: 0,
    overrides: 0,
    restored: 0,
    replace,
    skipped: 0,
  };

  if (items) {
    const wanted = new Map();
    for (const raw of items) {
      if (!raw || typeof raw !== "object") {
        imported.skipped += 1;
        continue;
      }
      const type = clean(raw.type, MAX_TYPE);
      const name = clean(raw.name, MAX_NAME);
      if (!type || !name) {
        imported.skipped += 1;
        continue;
      }
      wanted.set(keyOf(type, name), {
        type,
        name,
        at: snapshotAt(raw, at),
        note: clean(raw.note, MAX_NOTE),
      });
    }
    for (const row of wanted.values()) {
      imported.exclusions += 1;
      stmts.push(
        db
          .prepare(
            `INSERT INTO exclusions (type, name, at, note, status)
             VALUES (?, ?, ?, ?, 'excluded')
             ON CONFLICT(type, name) DO UPDATE SET
               at = excluded.at,
               note = excluded.note,
               status = 'excluded'`
          )
          .bind(row.type, row.name, row.at, row.note)
      );
    }
    if (replace) {
      const existing = await db
        .prepare(`SELECT type, name FROM exclusions WHERE status = 'excluded'`)
        .all();
      for (const row of existing.results) {
        if (wanted.has(keyOf(row.type, row.name))) continue;
        imported.restored += 1;
        stmts.push(
          db
            .prepare(
              `UPDATE exclusions SET status = 'restored'
               WHERE type = ? AND name = ? AND status = 'excluded'`
            )
            .bind(row.type, row.name)
        );
      }
    }
  }

  if (held) {
    const wanted = new Map();
    for (const raw of held) {
      if (!raw || typeof raw !== "object") {
        imported.skipped += 1;
        continue;
      }
      if (raw.status != null && raw.status !== "held") {
        imported.skipped += 1;
        continue;
      }
      const type = clean(raw.type, MAX_TYPE);
      const name = clean(raw.name, MAX_NAME);
      if (!type || !name) {
        imported.skipped += 1;
        continue;
      }
      wanted.set(keyOf(type, name), {
        type,
        name,
        at: snapshotAt(raw, at),
        note: clean(raw.note, MAX_NOTE),
      });
    }
    if (replace) {
      stmts.push(db.prepare(`DELETE FROM holds`));
      for (const row of wanted.values()) {
        imported.holds += 1;
        stmts.push(insertHold(db, row));
      }
    } else {
      const latest = await latestHoldMap(db);
      for (const row of wanted.values()) {
        const prev = latest.get(keyOf(row.type, row.name));
        if (prev && prev.status === "held" && prev.note === row.note) continue;
        const useAt = atForMerge(prev, row.at, at);
        imported.holds += 1;
        stmts.push(insertHold(db, { ...row, at: useAt }));
      }
    }
  }

  if (overrides) {
    const wanted = new Map();
    for (const raw of overrides) {
      if (!raw || typeof raw !== "object") {
        imported.skipped += 1;
        continue;
      }
      if (raw.status != null && raw.status !== "active") {
        imported.skipped += 1;
        continue;
      }
      const oldType = clean(raw.oldType ?? raw.type, MAX_TYPE);
      const name = clean(raw.name, MAX_NAME);
      const newType = clean(raw.newType, MAX_TYPE);
      const newSubtype = clean(raw.newSubtype, MAX_SUBTYPE);
      if (!oldType || !name || !newType) {
        imported.skipped += 1;
        continue;
      }
      wanted.set(keyOf(oldType, name), {
        oldType,
        name,
        newType,
        newSubtype,
        at: snapshotAt(raw, at),
        note: clean(raw.note, MAX_NOTE),
      });
    }
    if (replace) {
      stmts.push(db.prepare(`DELETE FROM overrides`));
      for (const row of wanted.values()) {
        imported.overrides += 1;
        stmts.push(insertOverride(db, row));
      }
    } else {
      const latest = await latestOverrideMap(db);
      for (const row of wanted.values()) {
        const prev = latest.get(keyOf(row.oldType, row.name));
        if (
          prev &&
          prev.status === "active" &&
          prev.new_type === row.newType &&
          prev.new_subtype === row.newSubtype &&
          prev.note === row.note
        ) {
          continue;
        }
        const useAt = atForMerge(prev, row.at, at);
        imported.overrides += 1;
        stmts.push(insertOverride(db, { ...row, at: useAt }));
      }
    }
  }

  if (stmts.length) await db.batch(stmts);
  return { imported };
}

function insertHold(db, row) {
  return db
    .prepare(
      `INSERT INTO holds (type, name, at, note, status) VALUES (?, ?, ?, ?, 'held')`
    )
    .bind(row.type, row.name, row.at, row.note);
}

function insertOverride(db, row) {
  return db
    .prepare(
      `INSERT INTO overrides (old_type, name, new_type, new_subtype, at, status, note)
       VALUES (?, ?, ?, ?, ?, 'active', ?)`
    )
    .bind(row.oldType, row.name, row.newType, row.newSubtype, row.at, row.note);
}

function atForMerge(prev, rowAt, serverAt) {
  if (!prev || rowAt > prev.at) return rowAt;
  if (serverAt > prev.at) return serverAt;
  return prev.at;
}

async function latestHoldMap(db) {
  const rows = await db.prepare(LATEST_HOLDS).all();
  const map = new Map();
  for (const row of rows.results) map.set(keyOf(row.type, row.name), row);
  return map;
}

async function latestOverrideMap(db) {
  const rows = await db.prepare(LATEST_OVERRIDES).all();
  const map = new Map();
  for (const row of rows.results) map.set(keyOf(row.old_type, row.name), row);
  return map;
}
