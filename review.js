'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const MAX_BYTES = 5 * 1024 * 1024;
  let reviewMap = null;
  let layer = null;

  const setStatus = text => { $('status').textContent = text; };
  const isNum = v => typeof v === 'number' && Number.isFinite(v);
  const fmtTime = sec => {
    const s = Math.floor(sec || 0);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + String(r).padStart(2, '0');
  };
  const pinIcon = (kind, label) => L.divIcon({
    className: 'map-pin-wrap map-pin-' + kind,
    html: '<span class="pin-body"><b>' + label + '</b></span>',
    iconSize: [30, 30],
    iconAnchor: [15, 30]
  });

  function validTrack(r) {
    return r && typeof r === 'object' && Array.isArray(r.points) && r.points.length > 0 && r.points.length <= 200000
      && isNum(r.seconds) && isNum(r.meters) && r.seconds >= 0 && r.meters >= 0
      && r.points.every(p => p && isNum(p.lat) && isNum(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180);
  }

  function parseCSV(text) {
    const rows = [];
    let row = [], cell = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
        else cell += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\r' || c === '\n') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (cell.length || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(x => x !== ''));
  }

  function ensureMap() {
    if (reviewMap) return;
    reviewMap = L.map('reviewMap', { zoomControl: true });
    addBaseMap(reviewMap);
  }

  function showTrack(r) {
    ensureMap();
    if (layer) layer.remove();
    layer = L.layerGroup().addTo(reviewMap);
    const groups = new Map();
    for (const p of r.points) {
      const k = p.segment || 0;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push([p.lat, p.lng]);
    }
    for (const pts of groups.values()) {
      if (pts.length < 2) continue;
      L.polyline(pts, { color: '#fff', weight: 9, opacity: 0.85, lineCap: 'round', lineJoin: 'round' }).addTo(layer);
      L.polyline(pts, { color: '#d95432', weight: 5, lineCap: 'round', lineJoin: 'round' }).addTo(layer);
    }
    const first = r.points[0], last = r.points[r.points.length - 1];
    const bounds = [[first.lat, first.lng]];
    L.marker([first.lat, first.lng], { icon: pinIcon('start', '起'), zIndexOffset: 500 }).bindTooltip('起點').addTo(layer);
    if (r.points.length > 1) {
      L.marker([last.lat, last.lng], { icon: pinIcon('end', '終'), zIndexOffset: 500 }).bindTooltip('終點').addTo(layer);
      bounds.push([last.lat, last.lng]);
    }
    $('detail').hidden = false;
    $('list').hidden = true;
    reviewMap.invalidateSize();
    reviewMap.fitBounds(bounds, { padding: [36, 36], maxZoom: 18 });
  }

  function addFact(dl, label, value) {
    const dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = label;
    dd.textContent = value;
    dl.append(dt, dd);
  }

  // 點編號從 1 開始，對應 JSON points 的順序；不跨段連線。
  function analyzeTrack(r) {
    let meters = 0, fastest = null, invalidTimes = 0, longIntervals = 0;
    const points = r.points;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      if ((a.segment || 0) !== (b.segment || 0)) continue;
      const distance = MoveCore.distance(a, b);
      meters += distance;
      if (!isNum(a.t) || !isNum(b.t) || b.t <= a.t) { invalidTimes++; continue; }
      const seconds = (b.t - a.t) / 1000;
      if (seconds > 30) longIntervals++;
      const speed = distance / seconds;
      if (!fastest || speed > fastest.speed) fastest = {from: i, to: i + 1, distance, seconds, speed};
    }
    const difference = r.meters - meters;
    return {meters, difference, percent: r.meters > 0 ? difference / r.meters * 100 : null,
      direct: MoveCore.distance(points[0], points[points.length - 1]), fastest, invalidTimes, longIntervals};
  }

  function showAnalysis(r) {
    const a = analyzeTrack(r), dl = $('analysisFacts');
    dl.replaceChildren();
    addFact(dl, '紀錄中的總距離', r.meters.toFixed(3) + ' 公尺');
    addFact(dl, '重新加總總距離', a.meters.toFixed(3) + ' 公尺（Haversine，半徑 6,371,000 公尺）');
    addFact(dl, '距離差值', a.difference.toFixed(6) + ' 公尺（紀錄值 − 重算值）');
    addFact(dl, '距離差異百分比', a.percent === null ? '不適用：紀錄距離為 0，不能作為除數' : a.percent.toFixed(6) + '%（保留正負號）');
    addFact(dl, '0.1% 參考檢查', a.percent === null ? '無法比較' : Math.abs(a.percent) < 0.1 ? '差異絕對值小於 0.1%' : '差異絕對值未小於 0.1%，請核對紀錄與算法版本');
    addFact(dl, '起終點直線距離', a.direct.toFixed(3) + ' 公尺（兩點球面最短距離，不是實際路徑長度）');
    addFact(dl, '運動經過時間', r.seconds.toFixed(3) + ' 秒（讀取紀錄中的計時，並非由定位時間差重新驗算）');
    addFact(dl, '平均速度明細', (r.seconds > 0 ? (r.meters / r.seconds * 3.6).toFixed(3) : '0.000') + ' km/h');
    const fastest = a.fastest;
    if (fastest) {
      addFact(dl, '最快相鄰點速度', fastest.speed.toFixed(6) + ' m/s（' + (fastest.speed * 3.6).toFixed(3) + ' km/h）');
      addFact(dl, '8 m/s 參考檢查', (fastest.speed <= 8 ? '未超過 8 m/s' : '超過 8 m/s，請核對軌跡資料') + (a.invalidTimes ? '；部分點缺少有效時間，檢查不完整' : ''));
      addFact(dl, '最快區間', '有效點第 ' + fastest.from + ' → ' + fastest.to + ' 點；距離 ' + fastest.distance.toFixed(3) + ' 公尺 ÷ ' + fastest.seconds.toFixed(3) + ' 秒');
    } else {
      addFact(dl, '最快相鄰點速度', '無法計算：需要同段內至少兩個時間有效且遞增的點');
    }
    if (a.invalidTimes) addFact(dl, '定位時間提醒', a.invalidTimes + ' 組同段相鄰點缺少有效時間或時間未遞增，未參與速度比較');
    if (a.longIntervals) addFact(dl, '定位間隔提醒', a.longIntervals + ' 組同段點相隔超過 30 秒；依檔案段號驗算，請核對是否遺失斷段標記');
    const body = $('fastestPoints');
    body.replaceChildren();
    $('fastestEvidence').hidden = !fastest;
    if (!fastest) return;
    for (const index of [fastest.from, fastest.to]) {
      const p = r.points[index - 1], date = new Date(p.t), row = document.createElement('tr');
      const values = [index, p.t, isNaN(date.getTime()) ? '時間超出日期範圍' : date.toISOString(), p.lat.toFixed(7), p.lng.toFixed(7)];
      for (const value of values) {
        const cell = document.createElement('td');
        cell.textContent = String(value);
        row.append(cell);
      }
      body.append(row);
    }
  }

  function showBreaks(r) {
    const body = $('breakRows');
    body.replaceChildren();
    if (!Array.isArray(r.breakEvents)) {
      $('breakNote').textContent = '舊紀錄未保存斷段原因，不能只根據段數推斷是暫停或斷訊。';
      return;
    }
    $('breakNote').textContent = r.breakEvents.length ? '時間為事件發生及下一段首個有效定位收到時的 UTC（Z）。點編號從 1 開始，對應 points。若結束前未恢復定位，後點留空；事件筆數不一定等於段數減一。' : '此紀錄未記錄到暫停或斷段事件。';
    const reasons = {manual_pause:'手動暫停', page_hidden:'離開頁面／切至背景', geolocation_error:'定位錯誤', signal_timeout:'超過 30 秒未收到定位更新', point_time_gap:'有效定位點時間差超過 30 秒'};
    const errorReasons = {1:'權限被拒絕', 2:'無法取得位置', 3:'定位逾時'};
    const time = t => isNum(t) && !isNaN(new Date(t).getTime()) ? new Date(t).toISOString() : '未記錄';
    const point = n => Number.isInteger(n) && n >= 1 && n <= r.points.length ? '第 ' + n + ' 點；t=' + (isNum(r.points[n-1].t) ? r.points[n-1].t : '未記錄') : '未取得有效點';
    for (const event of r.breakEvents) {
      if (!event || typeof event !== 'object') continue;
      let reason = Object.hasOwn(reasons, event.reason) ? reasons[event.reason] : '未識別原因';
      if (event.reason === 'geolocation_error' && Object.hasOwn(errorReasons, event.errorCode)) reason += '：' + errorReasons[event.errorCode];
      if (event.reason === 'point_time_gap' && isNum(event.intervalSeconds)) reason += '（' + event.intervalSeconds.toFixed(3) + ' 秒）';
      const row = document.createElement('tr');
      for (const value of [reason, time(event.at), point(event.fromPoint), point(event.toPoint), time(event.resumedAt)]) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      }
      body.append(row);
    }
  }

  function showEnergyComparison(r, energy, estimate, totalKcal) {
    const dl = $('energyComparison');
    dl.replaceChildren();
    const fixed = !r.energyMethod || r.energyMethod === 'fixed-met';
    if (!isNum(r.weight) || r.weight <= 0 || (!energy && (!fixed || !isNum(r.met) || r.met < 1))) {
      addFact(dl, '比較狀態', '缺少有效體重、活動強度或支援的算法，無法比較');
      return;
    }
    // 扣除同一批已計算區間的標準休息消耗，避免新舊版本混用時間。
    const coveredSeconds = energy ? energy.seconds + (estimate ? estimate.gapSeconds : 0) : r.seconds;
    const rest = MoveCore.calories(1, r.weight, coveredSeconds);
    const net = Math.max(0, totalKcal - rest);
    addFact(dl, '重算總消耗', totalKcal.toFixed(3) + ' kcal（包含標準休息消耗）');
    addFact(dl, '標準休息消耗', rest.toFixed(3) + ' kcal（1 MET 假設，非個人實測代謝）');
    addFact(dl, '活動淨消耗', net.toFixed(3) + ' kcal（相當於各區間 MET − 1）');
    addFact(dl, '兩者相差', rest.toFixed(3) + ' kcal');
    addFact(dl, '比較算式', totalKcal.toFixed(3) + ' − ' + rest.toFixed(3) + ' = ' + net.toFixed(3) + ' kcal（使用未四捨五入值計算）');
    addFact(dl, '休息消耗算式', '1 × 3.5 × ' + r.weight + ' kg ÷ 200 × ' + (coveredSeconds / 60).toFixed(6) + ' 分鐘');
    addFact(dl, '計算範圍', energy ? (estimate ? '有效區間加上 1 MET 補估；補估區間的淨活動消耗為 0，未知活動仍可能低估。' : '舊 ACSM 版本僅比較有效定位區間，未補算其餘運動時間。') : '舊固定 MET 版本以紀錄中的運動時間比較。');
    addFact(dl, 'MET − 1 的意思', '每個已估算區間扣除 1 MET 的標準休息消耗，不是將總熱量直接減 1 kcal。暫停期間不計。');
  }

  function showPrecision(r) {
    const result=PrecisionExperiment.compare(r),body=$('precisionRows');
    body.replaceChildren();
    $('precisionNote').textContent=result.note;
    $('precisionDelta').textContent='';
    if(result.mode==='unavailable') return;
    const label=result.mode==='complete'?'原始資料完整重播':result.mode==='unverified'?'原始資料重播未吻合':'有效點有限比較';
    for(const [limit,group] of [[35,result.before],[20,result.after]]) {
      const row=document.createElement('tr');
      for(const value of [limit+' 公尺',group.count+' 個',group.meters.toFixed(3)+' 公尺',group.segments+' 段',group.accuracyRejected+' 個',group.otherRejected+' 個']) {
        const cell=document.createElement('td');cell.textContent=value;row.append(cell);
      }
      body.append(row);
    }
    const signed=n=>(n>0?'+':'')+n;
    $('precisionDelta').textContent=label+'；輸入 '+result.inputCount+' 點。20 公尺組 − 35 公尺組：有效點 '+signed(result.countChange)
      +' 個，距離 '+signed(Number(result.distanceChange.toFixed(3)))+' 公尺（'+(result.distancePercent===null?'基準距離為零，不計百分比':signed(Number(result.distancePercent.toFixed(6)))+'%')+'）。';
  }

  function showFacts(r) {
    const km = r.meters / 1000, sec = r.seconds;
    const speed = sec > 0 ? km / (sec / 3600) : 0;
    const useRest = r.energyMethod === 'acsm-level-rest-v2';
    const energy = (useRest || r.energyMethod === 'acsm-level-v1') ? MoveCore.trackEnergy(r.points, r.activity, r.weight) : null;
    const estimate = useRest ? MoveCore.energyWithRest(energy, r.weight, sec) : null;
    const computedKcal = estimate ? estimate.kcal : energy ? energy.kcal : isNum(r.met) && isNum(r.weight) ? MoveCore.calories(r.met, r.weight, sec) : 0;
    const kcal = isNum(r.kcal) ? r.kcal : computedKcal;
    $('statDistance').textContent = km.toFixed(2);
    $('statTime').textContent = fmtTime(sec);
    $('statSpeed').textContent = speed.toFixed(1);
    $('statKcal').textContent = String(Math.round(kcal));

    const dl = $('facts');
    dl.replaceChildren();
    const pts = r.points;
    const first = pts[0], last = pts[pts.length - 1];
    const segments = new Set(pts.map(p => p.segment || 0)).size;
    const date = r.date ? new Date(r.date) : null;
    addFact(dl, '日期時間', date && !isNaN(date) ? date.toLocaleString('zh-TW') : '未記錄');
    addFact(dl, '紀錄類型', r.demo ? '示範（模擬座標與時間，不代表真實運動）' : 'GPS 真實紀錄');
    addFact(dl, '暱稱', r.alias || '未填寫');
    addFact(dl, '活動方式', r.mode || '未記錄');
    addFact(dl, '身高 ／ 體重 ／ 年齡', [r.height, r.weight, r.age].map((v, i) => v == null ? '—' : v + ['cm', 'kg', '歲'][i]).join(' ／ '));
    addFact(dl, '活動強度 MET', energy ? (energy.seconds > 0 ? (energy.kcal * 200 / (3.5 * r.weight * energy.seconds / 60)).toFixed(2) + '（有效定位區間加權平均）' : '等待足夠定位') : isNum(r.met) ? String(r.met) : '未記錄');
    if (energy) {
      addFact(dl, '熱量估算範圍', useRest ? '有效速度區間使用 ACSM；未涵蓋的運動時間以 1 MET 保守補估，暫停不計。假設平地，身高與年齡未參與。' : '僅含有定位的區間，假設平地；缺口及尚無速度的時間不推算，可能不完整。身高與年齡未參與。');
      addFact(dl, '公式適用提醒', energy.outsideRangeSeconds > 0 ? '部分速度超出常用範圍，結果含外推估算。' : '步行常用約 3–6 km/h；跑步約 8 km/h 以上。成人公式僅作教學估算。');
      if (estimate) {
        addFact(dl, '有效區間熱量', estimate.knownKcal.toFixed(2) + ' kcal');
        addFact(dl, '保守補估熱量', estimate.gapKcal.toFixed(2) + ' kcal（1 MET；非實際強度或個人最低消耗）');
      }
      addFact(dl, '熱量重新驗算', computedKcal.toFixed(1) + ' kcal；與儲存值差 ' + (kcal - computedKcal).toFixed(2) + ' kcal');
    }
    addFact(dl, '有效定位點', pts.length + ' 個，分為 ' + segments + ' 段（暫停或斷訊後會另起一段）');
    if (Array.isArray(r.rawPoints)) {
      const rejected = r.rawPoints.filter(p => p && p.accepted === false);
      addFact(dl, '定位篩選', '原始 ' + r.rawPoints.length + ' 點，採用 ' + pts.length + ' 點，排除 ' + rejected.length + ' 點');
      const reasons = new Map();
      for (const p of rejected) {
        const reason = typeof p.reason === 'string' ? p.reason : '未記錄原因';
        reasons.set(reason, (reasons.get(reason) || 0) + 1);
      }
      for (const [reason, count] of reasons) addFact(dl, '排除原因', reason + '（' + count + ' 點）');
    } else {
      addFact(dl, '定位篩選', '舊紀錄未保留原始定位點，無法回溯被排除的資料');
    }
    addFact(dl, '起點座標', first.lat.toFixed(5) + ', ' + first.lng.toFixed(5));
    addFact(dl, '終點座標', last.lat.toFixed(5) + ', ' + last.lng.toFixed(5));
    addFact(dl, '資料缺口', r.hasDataGap === true ? '曾有長時間未新增有效定位或定位中斷，可能漏記路程，距離與平均速度可能低估；停留原地也可能造成此提示。' : r.hasDataGap === false ? '未偵測到資料缺口（不代表路程完全無誤差）' : '舊紀錄未記載，無法判定');
    addFact(dl, '平均速度', speed.toFixed(2) + ' km/h（距離 ÷ 運動時間）');
    addFact(dl, '熱量算式', useRest ? '有效區間 ACSM 熱量 + 1 × 3.5 × 體重 ÷ 200 × 未涵蓋運動分鐘 = ' + kcal.toFixed(1) + ' kcal（含休息代謝與保守補估）' : energy ? 'ACSM：各有效區間 [(步行 0.1／跑步 0.2) × 速度 m/min + 3.5] × 體重 ÷ 200 × 區間分鐘，加總為 ' + kcal.toFixed(1) + ' kcal（含休息代謝，可能不完整）' : (isNum(r.met) && isNum(r.weight))
      ? r.met + ' × 3.5 × ' + r.weight + ' ÷ 200 × ' + (sec / 60).toFixed(1) + ' 分鐘 ＝ ' + kcal.toFixed(1) + ' kcal（估算值，非 GPS 測量）'
      : '未記錄');
    showAnalysis(r);
    showBreaks(r);
    showEnergyComparison(r, energy, estimate, computedKcal);
    showPrecision(r);
  }

  function showList(rows, name) {
    const head = rows[0], body = rows.slice(1);
    const distIdx = head.indexOf('距離 m');
    const kcalIdx = head.indexOf('總熱量 kcal');
    let meters = 0, kcal = 0;
    for (const r of body) {
      meters += Number(r[distIdx]) || 0;
      kcal += Number(r[kcalIdx]) || 0;
    }
    $('listSummary').textContent = name + '：共 ' + body.length + ' 筆，合計距離 ' + (meters / 1000).toFixed(2) + ' km，合計估算熱量 ' + Math.round(kcal) + ' kcal。CSV 只含摘要，沒有路線；要看路線請匯入軌跡 JSON。';
    const thead = $('listHead'), tbody = $('listBody');
    thead.replaceChildren();
    tbody.replaceChildren();
    const htr = document.createElement('tr');
    for (const h of head) { const th = document.createElement('th'); th.textContent = h; htr.append(th); }
    thead.append(htr);
    for (const r of body) {
      const tr = document.createElement('tr');
      for (const v of r) { const td = document.createElement('td'); td.textContent = v; tr.append(td); }
      tbody.append(tr);
    }
    $('list').hidden = false;
    $('detail').hidden = true;
  }

  async function handleFiles(files) {
    const list = [...files];
    if (!list.length) return;
    const f = list[0];
    if (f.size > MAX_BYTES) { setStatus(f.name + ' 超過 5 MB，無法開啟。'); return; }
    const text = (await f.text()).replace(/^﻿/, '');
    if (/\.json$/i.test(f.name) || f.type === 'application/json') {
      let r;
      try { r = JSON.parse(text); } catch { setStatus(f.name + ' 不是有效的 JSON 檔。'); return; }
      if (!validTrack(r)) { setStatus(f.name + ' 不是 PACE 的軌跡 JSON。請用「運動紀錄」的「軌跡」按鈕下載。'); return; }
      showTrack(r);
      showFacts(r);
      $('detail').hidden = false;
      setStatus('已開啟：' + f.name + (list.length > 1 ? '（一次只開啟第一份檔案）' : ''));
      return;
    }
    const rows = parseCSV(text);
    if (!rows.length || rows[0][0] !== '時間 ISO') { setStatus(f.name + ' 不是 PACE 的摘要 CSV。'); return; }
    showList(rows, f.name);
    setStatus('已開啟：' + f.name);
  }

  $('file').addEventListener('change', e => handleFiles(e.target.files));
  const drop = $('drop');
  ['dragenter', 'dragover'].forEach(ev => document.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => document.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  document.addEventListener('drop', e => handleFiles(e.dataTransfer.files));
})();
