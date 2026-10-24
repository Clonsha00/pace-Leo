import * as SQLite from 'expo-sqlite';
import type { Session } from '../types';

let connection: Promise<SQLite.SQLiteDatabase> | undefined;
let pending: Promise<unknown> = Promise.resolve();
function serialize<T>(action: () => Promise<T>): Promise<T> {
  const next = pending.then(action);
  pending = next.catch(() => undefined);
  return next;
}
async function database() {
  connection ??= (async () => {
    const db = await SQLite.openDatabaseAsync('pace-mobile.db');
    await db.execAsync(`PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS sessions (id INTEGER PRIMARY KEY, state TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT);
      INSERT OR IGNORE INTO metadata (key, value) VALUES ('active', NULL);`);
    return db;
  })().catch(error => { connection = undefined; throw error; });
  return connection;
}

export async function readActive(): Promise<Session | null> {
  const db = await database();
  const row = await db.getFirstAsync<{body: string}>(`SELECT s.body FROM sessions s
    JOIN metadata m ON m.key = 'active' AND s.id = CAST(m.value AS INTEGER)`);
  return row ? JSON.parse(row.body) : null;
}

export function insertActive(record: Session) {
  return serialize(async () => {
  const db = await database();
  await db.withExclusiveTransactionAsync(async tx => {
    const active = await tx.getFirstAsync<{value: string | null}>("SELECT value FROM metadata WHERE key = 'active'");
    if (active?.value) throw new Error('還有一筆未結束的運動，請繼續或結束後再開始。');
    await tx.runAsync('INSERT INTO sessions (id, state, body) VALUES (?, ?, ?)', record.id, record.state, JSON.stringify(record));
    await tx.runAsync("UPDATE metadata SET value = ? WHERE key = 'active'", String(record.id));
  });
  });
}

// 前景控制與背景批次共用交易；讀取、計算與寫入不可互相覆蓋。
export function mutateActive(change: (record: Session) => Session): Promise<Session | null> {
  return serialize(async () => {
  const db = await database();
  let result: Session | null = null;
  await db.withExclusiveTransactionAsync(async tx => {
    const row = await tx.getFirstAsync<{body: string}>(`SELECT s.body FROM sessions s
      JOIN metadata m ON m.key = 'active' AND s.id = CAST(m.value AS INTEGER)`);
    if (!row) return;
    const next = change(JSON.parse(row.body));
    await tx.runAsync('UPDATE sessions SET state = ?, body = ? WHERE id = ?', next.state, JSON.stringify(next), next.id);
    if (next.state === 'finished') await tx.runAsync("UPDATE metadata SET value = NULL WHERE key = 'active'");
    result = next;
  });
  return result;
  });
}

export async function listFinished(): Promise<Session[]> {
  const db = await database();
  const rows = await db.getAllAsync<{body: string}>("SELECT body FROM sessions WHERE state = 'finished' ORDER BY id DESC");
  return rows.map(row => JSON.parse(row.body));
}
