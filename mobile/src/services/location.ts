import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import * as Engine from '../engine.cjs';
import { insertActive, mutateActive, readActive } from './store';
import type { Profile } from '../types';

export const LOCATION_TASK = 'pace-background-location-v1';
let transitioning = false;
async function control<T>(action: () => Promise<T>): Promise<T> {
  if (transitioning) throw new Error('上一個定位操作尚未完成，請稍候。');
  transitioning = true;
  try { return await action(); }
  finally { transitioning = false; }
}

// 背景執行時不會掛載畫面：必須在模組頂層註冊，並直接寫入資料庫。
if (!TaskManager.isTaskDefined(LOCATION_TASK)) TaskManager.defineTask<{locations: Location.LocationObject[]}>(LOCATION_TASK, async ({data, error}) => {
  if (error) {
    await mutateActive(record => {
      if (record.state === 'running') {
        record.hasDataGap = true;
        record.locationErrors.push({at: Date.now(), message: error.message});
      }
      return record;
    });
    return;
  }
  if (!data?.locations?.length) return;
  const points = data.locations.map(location => ({lat: location.coords.latitude, lng: location.coords.longitude,
    t: location.timestamp, accuracy: location.coords.accuracy ?? -1}));
  await mutateActive(record => Engine.ingest(record, points, Date.now()));
});

async function permissions() {
  if (Platform.OS === 'web' || !await TaskManager.isAvailableAsync()) throw new Error('背景定位需要原生開發測試版，不能在網頁或 Expo Go 驗證。');
  if (!await Location.hasServicesEnabledAsync()) throw new Error('請先開啟手機定位服務。');
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (!foreground.granted) throw new Error('需要位置權限才能記錄運動。');
  const background = await Location.requestBackgroundPermissionsAsync();
  if (!background.granted) throw new Error('需要「永遠」允許定位，才能測試背景記錄。若先前選了「允許一次」，請到 iPhone 設定調整。');
}

async function enableTracking() {
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.BestForNavigation,
    distanceInterval: 2,
    pausesUpdatesAutomatically: false,
    activityType: Location.ActivityType.Fitness,
    showsBackgroundLocationIndicator: true,
    foregroundService: {notificationTitle: 'PACE 運動記錄中', notificationBody: '正在記錄路線；返回 App 可暫停或結束。'},
  });
}

export async function startSession(profile: Profile) {
  return control(async () => {
  await permissions();
  await insertActive(Engine.createSession(profile, Date.now()));
  try { await enableTracking(); }
  catch (error) {
    await mutateActive(record => Engine.pause(record, Date.now(), 'geolocation_error'));
    throw error;
  }
  });
}

export async function pauseSession() {
  return control(async () => {
  // 先持久化暫停狀態，晚到的原生回呼不再追加距離。
  await mutateActive(record => Engine.pause(record));
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  });
}

export async function resumeSession() {
  return control(async () => {
  await permissions();
  await mutateActive(record => Engine.resume(record));
  try { await enableTracking(); }
  catch (error) {
    await mutateActive(record => Engine.pause(record, Date.now(), 'geolocation_error'));
    throw error;
  }
  });
}

export async function finishSession() {
  return control(async () => {
  const record = await mutateActive(record => Engine.finish(record));
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  return record;
  });
}

export async function reconcileTracking() {
  // iOS 權限視窗也會觸發 AppState active；啟動尚未完成時不可誤判任務停止。
  if (transitioning) return false;
  return control(async () => {
  const record = await readActive();
  const enabled = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  if (!record || record.state !== 'running') {
    if (enabled) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    return false;
  }
  if (!enabled) {
    await mutateActive(current => {
      if (current.id !== record.id || current.state !== 'running') return current;
      current.hasDataGap = true;
      return Engine.pause(current, current.lastDeliveryAt ?? current.requestedAt, 'tracking_interrupted');
    });
    return true;
  }
  return false;
  });
}
