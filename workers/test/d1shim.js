import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

function plain(row) {
  if (row == null) return null;
  return { ...row };
}

class Statement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new Statement(this.db, this.sql, params);
  }

  _sync() {
    return this.db.prepare(this.sql);
  }

  async first() {
    return plain(this._sync().get(...this.params));
  }

  async all() {
    const results = this._sync().all(...this.params).map((row) => plain(row));
    return { results, success: true, meta: {} };
  }

  async run() {
    const info = this._sync().run(...this.params);
    return {
      success: true,
      meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) },
    };
  }
}

export class D1Shim {
  constructor(db) {
    this.db = db;
  }

  prepare(sql) {
    return new Statement(this.db, sql);
  }

  async batch(statements) {
    this.db.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.db.exec("COMMIT");
      return results;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }
}

export function createTestDb() {
  const db = new DatabaseSync(":memory:");
  const sql = readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8");
  db.exec(sql);
  return new D1Shim(db);
}
