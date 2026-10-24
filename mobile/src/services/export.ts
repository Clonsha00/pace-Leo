import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { Session } from '../types';

export async function exportTrack(record: Session) {
  if (record.state !== 'finished') throw new Error('請先結束運動，再匯出軌跡。');
  if (!record.points.length) throw new Error('沒有有效定位點，無法匯出可供網站分析的軌跡。');
  if (!await Sharing.isAvailableAsync()) throw new Error('此裝置目前無法開啟檔案分享。');
  const file = new File(Paths.cache, `campus-track-${record.id}.json`);
  file.create({overwrite: true});
  file.write(JSON.stringify(record, null, 2));
  await Sharing.shareAsync(file.uri, {mimeType: 'application/json', UTI: 'public.json', dialogTitle: '匯出 PACE 軌跡'});
}
