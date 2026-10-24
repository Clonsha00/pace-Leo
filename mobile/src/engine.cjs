// 網頁與手機共用同一份計算核心，避免距離與熱量公式分歧。
const Core = require('../../core.js');
/** @typedef {import('./types').Session} Session */
/** @typedef {import('./types').Profile} Profile */
/** @typedef {import('./types').Point} Point */

/** @param {Profile} profile @returns {Session} */
function createSession(profile, now = Date.now()) {
  if (!Number.isFinite(profile.weight) || profile.weight < 20 || profile.weight > 250 ||
    !Number.isFinite(profile.height) || profile.height < 80 || profile.height > 230 ||
    !Number.isFinite(profile.age) || profile.age < 6 || profile.age > 100 ||
    !['walk', 'run'].includes(profile.activity)) throw new Error('請確認身高、體重、年齡與活動方式。');
  return {...profile, id: now, date: new Date(now).toISOString(), source: 'expo-native',
    mode: profile.activity === 'walk' ? '步行 · 依速度估算' : '跑步 · 依速度估算', demo: false,
    state: 'running', seconds: 0, runStart: null, requestedAt: now, latestTimestamp: null,
    lastDeliveryAt: null, needsNewSegment: true, meters: 0, points: [], rawPoints: [],
    rawRun: 1, rawFormatVersion: 1, breakFormatVersion: 1, breakEvents: [],
    energyMethod: 'acsm-level-rest-v2', energy: {kcal: 0, seconds: 0, outsideRangeSeconds: 0},
    hasDataGap: false, locationErrors: []};
}

/** @param {Session} record */
function elapsed(record, now = Date.now()) {
  return record.seconds + (record.state === 'running' && record.runStart !== null ? Math.max(0, now - record.runStart) / 1000 : 0);
}

/** @param {Session} record */
function addBreak(record, reason, now, details = {}) {
  record.breakEvents.push({reason, at: now, fromPoint: record.points.length || null, toPoint: null, resumedAt: null, ...details});
}

/** 背景可能成批補送定位；排序處理，舊批次與重複時間不重算距離。
 * @param {Session} record @param {Point[]} points
 */
function ingest(record, points, now = Date.now()) {
  if (record.state !== 'running') return record;
  for (const p of [...points].sort((a, b) => a.t - b.t)) {
    const last = record.needsNewSegment ? null : record.points.at(-1);
    const dt = last ? (p.t - last.t) / 1000 : null;
    const meters = last ? Core.distance(last, p) : null;
    let result = Core.accept(last, p);
    if (Number.isFinite(p.t) && (p.t < record.requestedAt || (record.latestTimestamp !== null && p.t <= record.latestTimestamp))) {
      result = {ok: false, reason: '略過先前區間或重複時間的定位。'};
    } else if (p.t > now) {
      result = {ok: false, reason: '略過時間超前於裝置時鐘的定位。'};
    }
    record.rawPoints.push({...p, run: record.rawRun, accepted: result.ok,
      reason: result.reason || (result.break ? '起點或新段落' : '通過篩選'),
      referencePoint: last ? record.points.length - 1 : null, intervalSeconds: dt,
      distanceMeters: meters, speedMps: dt > 0 ? meters / dt : null, startsSegment: !!(result.ok && result.break)});
    record.lastDeliveryAt = now;
    if (Number.isFinite(p.t) && p.t <= now) record.latestTimestamp = Math.max(record.latestTimestamp ?? p.t, p.t);
    if (!result.ok) continue;
    if (last && result.break) {
      record.hasDataGap = true;
      addBreak(record, 'point_time_gap', now, {intervalSeconds: dt});
    }
    if (record.runStart === null) record.runStart = Math.max(record.requestedAt, p.t);
    const segment = last ? (last.segment || 0) + (result.break ? 1 : 0) : record.points.length ? (record.points.at(-1).segment || 0) + 1 : 0;
    if (!last || result.break) {
      for (const event of record.breakEvents) {
        if (event.toPoint === null && event.fromPoint === (record.points.length || null)) {
          event.toPoint = record.points.length + 1; event.resumedAt = now;
        }
      }
    }
    record.meters += result.meters;
    if (last && !result.break) {
      const e = Core.energyInterval(record.activity, record.weight, result.meters, dt);
      if (e) {
        record.energy.kcal += e.kcal; record.energy.seconds += e.seconds;
        if (e.outsideRange) record.energy.outsideRangeSeconds += e.seconds;
      }
    }
    record.points.push({...p, segment});
    record.needsNewSegment = false;
  }
  return record;
}

/** @param {Session} record */
function pause(record, now = Date.now(), reason = 'manual_pause') {
  if (record.state !== 'running') return record;
  const last = record.points.at(-1);
  if (last && now - last.t > 30000) record.hasDataGap = true;
  addBreak(record, reason, now);
  record.seconds = elapsed(record, now); record.runStart = null;
  record.state = 'paused'; record.needsNewSegment = true;
  return record;
}

/** @param {Session} record */
function resume(record, now = Date.now()) {
  if (record.state !== 'paused') throw new Error('只有暫停中的紀錄可以繼續。');
  record.state = 'running'; record.runStart = null; record.requestedAt = now;
  record.needsNewSegment = true; record.rawRun++;
  return record;
}

/** @param {Session} record */
function snapshot(record, now = Date.now()) {
  const seconds = elapsed(record, now);
  const energyEstimate = Core.energyWithRest(record.energy, record.weight, seconds);
  const last = record.points.at(-1);
  return {...record, seconds, energyEstimate, kcal: energyEstimate.kcal,
    met: seconds > 0 ? energyEstimate.kcal * 200 / (3.5 * record.weight * seconds / 60) : 0,
    hasDataGap: record.hasDataGap || !!(record.state === 'running' && last && now - last.t > 30000)};
}

/** @param {Session} record @returns {Session} */
function finish(record, now = Date.now()) {
  if (record.state === 'finished') return record;
  const result = snapshot(record, now);
  return {...result, runStart: null, state: 'finished'};
}

module.exports = {createSession, elapsed, ingest, pause, resume, snapshot, finish};
