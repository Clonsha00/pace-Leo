const assert = require('node:assert/strict');
const E = require('../src/engine.cjs');
const Core = require('../../core.js');
const profile = {alias: '測試', weight: 60, height: 165, age: 20, activity: 'walk'};
const start = 1700000000000;
const point = (seconds, meters = seconds) => ({lat: 24, lng: 120 + meters / 101580, t: start + seconds * 1000, accuracy: 4});
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

// 延後成批送達的點必須按定位時間計算，不依畫面更新次數計時。
const r = E.createSession(profile, start);
E.ingest(r, [point(20), point(0), point(10)], start + 25000);
assert.equal(r.points.length, 3);
assert.equal(E.elapsed(r, start + 25000), 25);
close(r.meters, Core.distance(point(0), point(10)) + Core.distance(point(10), point(20)));
close(r.energy.kcal, Core.trackEnergy(r.points, 'walk', 60).kcal);
const meters = r.meters;
E.ingest(r, [point(10), point(20)], start + 26000);
assert.equal(r.meters, meters);
assert.equal(r.points.length, 3);
assert.equal(r.rawPoints.filter(p => !p.accepted).length, 2);

// 沒有新定位仍保留運動經過時間，僅補估消耗，不補造路程。
const gap = E.snapshot(r, start + 60000);
assert.equal(gap.state, 'running');
assert.equal(gap.seconds, 60);
assert.equal(gap.hasDataGap, true);
assert.equal(gap.energyEstimate.gapSeconds, 40);
close(gap.kcal, r.energy.kcal + Core.calories(1, 60, 40));
assert.equal(gap.meters, meters);
E.ingest(r, [point(65, 300)], start + 70000);
assert.equal(r.meters, meters);
assert.equal(r.points.at(-1).segment, 1);
assert.equal(r.breakEvents[0].reason, 'point_time_gap');

// 暫停後不收回呼；恢復時排除前一區間的晚到點，不跨暫停連線。
E.pause(r, start + 70000);
E.ingest(r, [point(75, 310)], start + 75000);
assert.equal(r.points.length, 4);
assert.equal(E.elapsed(r, start + 200000), 70);
E.resume(r, start + 200000);
E.ingest(r, [point(80, 320), point(205, 400), point(215, 410)], start + 220000);
assert.equal(r.points.at(-2).segment, 2);
assert.equal(r.points.length, 6);
assert.equal(E.elapsed(r, start + 220000), 85);
assert.equal(r.energy.seconds, 30);
assert.equal(r.rawPoints.at(-3).accepted, false);

// 從 JSON 還原後可繼續計算；結束後不再更動紀錄。
const restored = JSON.parse(JSON.stringify(r));
const finished = E.finish(restored, start + 225000);
assert.equal(finished.seconds, 90);
assert.equal(finished.state, 'finished');
assert.equal(finished.runStart, null);
const before = JSON.stringify(finished);
E.ingest(finished, [point(230, 425)], start + 230000);
assert.equal(JSON.stringify(finished), before);
close(finished.kcal, Core.energyWithRest(finished.energy, 60, 90).kcal);

const bad = E.createSession(profile, start);
E.ingest(bad, [{...point(0), accuracy: 100}, point(10)], start + 5000);
assert.equal(bad.points.length, 0);
assert.equal(E.elapsed(bad, start + 10000), 0);
assert.throws(() => E.createSession({...profile, weight: NaN}, start));
const pausedGap = E.createSession(profile, start);
E.ingest(pausedGap, [point(0)], start);
E.pause(pausedGap, start + 60000);
assert.equal(E.finish(pausedGap, start + 100000).hasDataGap, true);
console.log('PASS: 背景批次、共用公式、缺口補估、暫停恢復、JSON 還原與結束後保護');
