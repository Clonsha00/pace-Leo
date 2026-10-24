import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Engine from '../engine.cjs';
import { readActive, listFinished } from '../services/store';
import { startSession, pauseSession, resumeSession, finishSession, reconcileTracking } from '../services/location';
import { exportTrack } from '../services/export';
import type { Activity, Profile, Session } from '../types';

const center = {latitude: 24.1796, longitude: 120.6495, latitudeDelta: .008, longitudeDelta: .008};
const time = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(Math.floor(n % 60)).padStart(2, '0')}`;
const stateLabel = {running: '記錄中', paused: '已暫停', finished: '已結束'};

function Button({label, onPress, disabled = false, secondary = false}: {label: string; onPress: () => void; disabled?: boolean; secondary?: boolean}) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}
    style={({pressed}) => [styles.button, secondary && styles.secondary, disabled && styles.disabled, pressed && styles.pressed]}>
    <Text style={[styles.buttonText, secondary && styles.secondaryText]}>{label}</Text>
  </Pressable>;
}

function Route({record}: {record: Session | null}) {
  const map = useRef<MapView>(null);
  const last = record?.points.at(-1);
  const latitude = last?.lat, longitude = last?.lng;
  useEffect(() => {
    if (latitude !== undefined && longitude !== undefined) map.current?.animateToRegion({...center, latitude, longitude}, 300);
  }, [latitude, longitude]);
  const enabled = Constants.expoConfig?.extra?.googleMapsConfigured?.[Platform.OS] === true;
  if (!enabled) return <View style={styles.mapPlaceholder}><Text style={styles.sectionTitle}>Google Maps 尚未設定</Text><Text style={styles.note}>需要設定此 App 的 Google Maps 金鑰並重新打包。背景定位與本機記錄可先獨立測試。</Text></View>;
  const groups = new Map<number, {latitude: number; longitude: number}[]>();
  for (const point of record?.points ?? []) {
    const segment = point.segment || 0;
    if (!groups.has(segment)) groups.set(segment, []);
    groups.get(segment)!.push({latitude: point.lat, longitude: point.lng});
  }
  const first = record?.points[0];
  return <MapView ref={map} provider={PROVIDER_GOOGLE} style={styles.map} initialRegion={last ? {...center, latitude: last.lat, longitude: last.lng} : center} showsUserLocation={false}>
    {[...groups].map(([segment, points]) => <Polyline key={segment} coordinates={points} strokeColor="#d95432" strokeWidth={5} />)}
    {first && <Marker coordinate={{latitude: first.lat, longitude: first.lng}} title="起點" />}
    {!!record?.points.length && <Marker coordinate={{latitude: record.points.at(-1)!.lat, longitude: record.points.at(-1)!.lng}} title="最後有效定位" pinColor="#397da1" />}
  </MapView>;
}

export default function Home() {
  const [active, setActive] = useState<Session | null>(null);
  const [history, setHistory] = useState<Session[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [consent, setConsent] = useState(false);
  const [alias, setAlias] = useState('');
  const [weight, setWeight] = useState('60');
  const [height, setHeight] = useState('165');
  const [age, setAge] = useState('20');
  const [activity, setActivity] = useState<Activity>('walk');

  const refresh = useCallback(async () => {
    const [record, finished] = await Promise.all([readActive(), listFinished()]);
    setActive(record); setHistory(finished); setNow(Date.now());
  }, []);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try { if (mounted) await refresh(); }
      catch (e) { if (mounted) setError(e instanceof Error ? e.message : '無法讀取本機紀錄'); }
    };
    const reconcile = async () => {
      try {
        const interrupted = await reconcileTracking();
        if (interrupted && mounted) setError('原生定位任務曾停止，已回復到最後收到資料的時間並暫停。請確認權限後按繼續。');
        await load();
      } catch (e) { if (mounted) setError(e instanceof Error ? e.message : '無法檢查定位任務'); }
    };
    void reconcile();
    const interval = setInterval(() => { if (AppState.currentState === 'active') void load(); }, 1000);
    const listener = AppState.addEventListener('change', state => { if (state === 'active') void reconcile(); });
    return () => { mounted = false; clearInterval(interval); listener.remove(); };
  }, [refresh]);

  async function perform(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); }
    catch (e) { setError(e instanceof Error ? e.message : '操作失敗，請重試'); }
    finally { try { await refresh(); } catch (e) { setError(e instanceof Error ? e.message : '無法讀取紀錄'); } setBusy(false); }
  }
  const record = active ? Engine.snapshot(active, now) : null;
  const frozenForm = !!active || busy;
  const profile: Profile = {alias: alias.trim().slice(0, 24), weight: Number(weight), height: Number(height), age: Number(age), activity};

  return <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}><StatusBar style="dark" />
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.brand}>PACE <Text style={styles.brandSmall}>iPhone 開發測試版</Text></Text>
      <Text style={styles.title}>運動繼續，畫面可以休息。</Text>
      <Text style={styles.subtitle}>切換 App 不會主動暫停。定位點由原生背景任務寫入手機，再同步更新畫面。</Text>
      <View style={styles.notice}><Text style={styles.noticeTitle}>背景記錄測試</Text><Text style={styles.note}>需要安裝開發測試版、開啟精確位置並「永遠」允許定位。強制關閉 App、省電與系統限制仍可能中斷記錄，請以實機結果為準。</Text></View>
      {!!error && <View style={styles.warning} accessibilityRole="alert"><Text style={styles.warningText}>{error}</Text><Button label="開啟手機設定" secondary onPress={() => void Linking.openSettings()} /></View>}

      <View style={styles.card}>
        <View style={styles.row}><Text style={styles.sectionTitle}>本次運動</Text><Text style={styles.badge}>{active ? stateLabel[active.state] : '準備開始'}</Text></View>
        <Text style={styles.distance}>{((record?.meters ?? 0) / 1000).toFixed(2)} <Text style={styles.unit}>km</Text></Text>
        <View style={styles.metrics}><View><Text style={styles.label}>運動時間</Text><Text style={styles.metric}>{time(record?.seconds ?? 0)}</Text></View><View><Text style={styles.label}>平均速度</Text><Text style={styles.metric}>{record && record.seconds > 0 ? (record.meters / record.seconds * 3.6).toFixed(1) : '0.0'} <Text style={styles.unit}>km/h</Text></Text></View></View>
        <View style={styles.metrics}><View><Text style={styles.label}>總消耗（估算）</Text><Text style={styles.metric}>{Math.round(record?.kcal ?? 0)} <Text style={styles.unit}>kcal</Text></Text></View><View><Text style={styles.label}>有效定位點</Text><Text style={styles.metric}>{record?.points.length ?? 0}</Text></View></View>
        {record && <><Text style={styles.note}>有效區間 {record.energy.kcal.toFixed(1)} kcal · 1 MET 保守補估 {record.energyEstimate!.gapKcal.toFixed(1)} kcal。包含標準休息消耗，非個人精確消耗。</Text>{active?.runStart === null && active.state === 'running' && <Text style={styles.note}>等待第一個有效定位後開始計時。</Text>}</>}
        {record?.hasDataGap && <Text style={styles.gap}>可能有定位缺口，路程與速度可能低估。未取得有效速度的計時以 1 MET 補估，無法推算遺失路程。</Text>}
        {!!record?.locationErrors.length && <Text style={styles.gap}>最近定位錯誤：{record.locationErrors.at(-1)?.message}</Text>}
        <Route record={record} />
        {active ? <View style={styles.actions}><Button label={active.state === 'running' ? '暫停' : '繼續'} secondary disabled={busy} onPress={() => void perform(active.state === 'running' ? pauseSession : resumeSession)} /><Button label="結束並儲存" disabled={busy} onPress={() => Alert.alert('結束本次運動？', '停止定位並保存到這支手機。', [{text: '繼續運動', style: 'cancel'}, {text: '結束並儲存', onPress: () => void perform(finishSession)}])} /></View> : null}
      </View>

      {!active && <View style={styles.card}><Text style={styles.sectionTitle}>準備出發</Text><Text style={styles.note}>選擇步行或跑步。體重用於熱量估算，身高與年齡僅作資料留存。</Text>
        <Text style={styles.label}>暱稱（選填）</Text><TextInput accessibilityLabel="暱稱" value={alias} onChangeText={setAlias} editable={!frozenForm} maxLength={24} style={styles.input} placeholder="例如 Leo" />
        <View style={styles.formRow}>{[['體重 kg', weight, setWeight], ['身高 cm', height, setHeight], ['年齡', age, setAge]].map(([label, value, setter]) => <View style={styles.formField} key={label as string}><Text style={styles.label}>{label as string}</Text><TextInput accessibilityLabel={label as string} style={styles.input} value={value as string} onChangeText={setter as (text: string) => void} editable={!frozenForm} keyboardType="decimal-pad" /></View>)}</View>
        <View style={styles.actions}><Button label="步行" secondary={activity !== 'walk'} disabled={busy} onPress={() => setActivity('walk')} /><Button label="跑步" secondary={activity !== 'run'} disabled={busy} onPress={() => setActivity('run')} /></View>
        <View style={styles.consent}><Switch accessibilityLabel="同意在手機記錄位置與運動資料" value={consent} onValueChange={setConsent} disabled={busy} /><Text style={styles.consentText}>同意在這支手機記錄位置與運動資料。開始後會持續定位，直到暫停或結束。</Text></View>
        <Button label={busy ? '處理中…' : '開始背景定位運動'} disabled={!consent || busy} onPress={() => void perform(() => startSession(profile))} />
      </View>}

      <View style={styles.card}><Text style={styles.sectionTitle}>這支手機的運動紀錄</Text><Text style={styles.note}>匯出 JSON 後，可在原 PACE 網站的「運動分析」驗算。完整位置不會自動上傳。</Text>
        {!history.length && <Text style={styles.empty}>完成第一筆運動後，紀錄會顯示在這裡。</Text>}
        {history.map(item => <View key={item.id} style={styles.history}><Text style={styles.historyTitle}>{item.alias || item.mode} · {(item.meters / 1000).toFixed(2)} km</Text><Text style={styles.note}>{new Date(item.date).toLocaleString()} · {time(item.seconds)} · {Math.round(item.kcal ?? 0)} kcal</Text><Button secondary label="匯出軌跡 JSON" disabled={busy || !item.points.length} onPress={() => void perform(() => exportTrack(item))} />{!item.points.length && <Text style={styles.note}>沒有有效定位點，無法匯出路線分析。</Text>}</View>)}
      </View>
      <Text style={styles.footer}>暫停或結束會停止原生定位。尚未取得的點無法補回；背景任務已註冊不代表 GPS 永不中斷。</Text>
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: {flex: 1, backgroundColor: '#f5f5ee'}, content: {padding: 22, paddingBottom: 48, maxWidth: 700, width: '100%', alignSelf: 'center', gap: 18},
  brand: {fontSize: 26, fontWeight: '800', color: '#293e35'}, brandSmall: {fontSize: 12, fontWeight: '500', color: '#718066'},
  title: {fontSize: 25, fontWeight: '700', lineHeight: 35, color: '#293e35'}, subtitle: {fontSize: 14, lineHeight: 24, color: '#65705d'},
  notice: {padding: 16, backgroundColor: '#e8eddf', borderRadius: 12, gap: 7}, noticeTitle: {color: '#405c36', fontSize: 14, fontWeight: '700'},
  note: {fontSize: 12, lineHeight: 21, color: '#66725f'}, card: {backgroundColor: 'white', borderWidth: 1, borderColor: '#dfe5d6', borderRadius: 16, padding: 20, gap: 14},
  row: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}, sectionTitle: {fontSize: 18, fontWeight: '700', color: '#293e35'}, badge: {fontSize: 12, color: '#4f6b45', backgroundColor: '#edf1e6', padding: 7, borderRadius: 6},
  distance: {fontSize: 54, fontWeight: '700', color: '#293e35', fontVariant: ['tabular-nums']}, unit: {fontSize: 12, fontWeight: '400', color: '#728168'},
  metrics: {flexDirection: 'row', justifyContent: 'space-between', gap: 20}, label: {fontSize: 12, color: '#66725f', marginBottom: 5}, metric: {fontSize: 25, fontWeight: '600', color: '#293e35', fontVariant: ['tabular-nums']},
  actions: {flexDirection: 'row', gap: 12}, button: {backgroundColor: '#c75031', paddingVertical: 14, paddingHorizontal: 18, borderRadius: 8, flexGrow: 1, alignItems: 'center', justifyContent: 'center', minHeight: 48}, buttonText: {fontSize: 14, color: 'white', fontWeight: '600'}, secondary: {backgroundColor: '#eaf0e1'}, secondaryText: {color: '#405b34'}, disabled: {opacity: .45}, pressed: {opacity: .75},
  input: {borderWidth: 1, borderColor: '#cbd4c1', borderRadius: 7, padding: 12, color: '#293e35', minHeight: 46}, formRow: {flexDirection: 'row', gap: 10}, formField: {flex: 1}, consent: {flexDirection: 'row', gap: 12, alignItems: 'center'}, consentText: {flex: 1, color: '#66725f', fontSize: 12, lineHeight: 21},
  map: {height: 260, borderRadius: 10}, mapPlaceholder: {minHeight: 130, padding: 18, backgroundColor: '#eff2e8', borderRadius: 10, justifyContent: 'center', gap: 10},
  warning: {padding: 16, backgroundColor: '#fff0dc', borderRadius: 10, gap: 12}, warningText: {fontSize: 13, color: '#7d481e', lineHeight: 23}, gap: {backgroundColor: '#fff2d9', padding: 12, color: '#76501e', fontSize: 12, lineHeight: 22, borderRadius: 7},
  history: {gap: 10, borderTopWidth: 1, borderTopColor: '#e6ebde', paddingTop: 16}, historyTitle: {color: '#293e35', fontWeight: '600', fontSize: 14}, empty: {paddingVertical: 15, color: '#77866c', fontSize: 13, lineHeight: 22}, footer: {fontSize: 11, lineHeight: 20, color: '#77866c'},
});
