const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const {DatabaseSync} = require('node:sqlite');
const E = require('../src/engine.cjs');
function load(relative, dependencies) {
  const source = fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
  const js = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  const exports = {};
  vm.runInNewContext(js, {exports, require: id => {
    assert.ok(id in dependencies, `Unmocked import: ${id}`);
    return dependencies[id];
  }, Date, console}, {filename: relative});
  return exports;
}
async function main() {
  // 真正 SQLite SQL 驗證；只替換 Expo 的平台橋接，非 iPhone 原生執行測試。
  const db = new DatabaseSync(':memory:');
  const adapter = {
    execAsync: async sql => db.exec(sql),
    getFirstAsync: async (sql, ...args) => db.prepare(sql).get(...args) ?? null,
    getAllAsync: async (sql, ...args) => db.prepare(sql).all(...args),
    runAsync: async (sql, ...args) => db.prepare(sql).run(...args),
    withExclusiveTransactionAsync: async action => {
      db.exec('BEGIN IMMEDIATE');
      try { await action(adapter); db.exec('COMMIT'); }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  };
  const dependencies = {'expo-sqlite': {openDatabaseAsync: async () => adapter}};
  const store = load('src/services/store.ts', dependencies);
  const now = Date.now();
  const profile = {alias: '', weight: 60, height: 165, age: 20, activity: 'walk'};
  await store.insertActive(E.createSession(profile, now));
  await assert.rejects(store.insertActive(E.createSession(profile, now + 1)));
  await Promise.all(Array.from({length: 20}, () => store.mutateActive(r => {r.seconds++; return r;})));
  assert.equal((await store.readActive()).seconds, 20);
  await assert.rejects(store.mutateActive(r => {r.seconds = 999; throw new Error('abort');}));
  assert.equal((await store.readActive()).seconds, 20);
  const reopened = load('src/services/store.ts', dependencies);
  assert.equal((await reopened.readActive()).id, now);
  await store.mutateActive(r => E.finish(r, now));
  assert.equal(await store.readActive(), null);
  assert.equal((await store.listFinished()).length, 1);
  assert.equal(await store.mutateActive(r => r), null);

  let tracking = false;
  let task;
  let release;
  const prompt = new Promise(resolve => {release = resolve;});
  const location = {
    Accuracy: {BestForNavigation: 6}, ActivityType: {Fitness: 3},
    hasServicesEnabledAsync: async () => true,
    requestForegroundPermissionsAsync: async () => {await prompt; return {granted: true};},
    requestBackgroundPermissionsAsync: async () => ({granted: true}),
    startLocationUpdatesAsync: async () => {tracking = true;},
    hasStartedLocationUpdatesAsync: async () => tracking,
    stopLocationUpdatesAsync: async () => {tracking = false;},
  };
  const service = load('src/services/location.ts', {
    'expo-location': location,
    'expo-task-manager': {isTaskDefined: () => false, defineTask: (_, fn) => {task = fn;}, isAvailableAsync: async () => true},
    'react-native': {Platform: {OS: 'ios'}}, '../engine.cjs': E, './store': store,
  });
  const starting = service.startSession(profile);
  assert.equal(await service.reconcileTracking(), false, '權限視窗返回不可暫停尚在啟動的任務');
  release();
  await starting;
  assert.equal(tracking, true);
  assert.equal((await store.readActive()).state, 'running');
  await task({data: {locations: [{timestamp: Date.now(), coords: {latitude: 24, longitude: 120, accuracy: 4}}]}});
  assert.equal((await store.readActive()).points.length, 1);
  await service.pauseSession();
  assert.equal(tracking, false);
  await task({data: {locations: [{timestamp: Date.now(), coords: {latitude: 24, longitude: 120.001, accuracy: 4}}]}});
  assert.equal((await store.readActive()).points.length, 1);
  await service.resumeSession();
  tracking = false; // 模擬原生任務被停止。
  assert.equal(await service.reconcileTracking(), true);
  assert.equal((await store.readActive()).state, 'paused');
  assert.equal((await store.readActive()).hasDataGap, true);
  await service.finishSession();
  assert.equal(await store.readActive(), null);
  assert.equal((await store.listFinished()).length, 2);
  db.close();
  console.log('PASS: SQLite 交易、並行更新、回滾、重新載入，以及模擬原生啟動／權限／暫停／中斷');
}
main().catch(error => {console.error(error); process.exitCode = 1;});
