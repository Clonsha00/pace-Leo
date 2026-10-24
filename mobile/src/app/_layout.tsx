// 必須先載入背景任務；iOS 喚醒背景執行時，沒有任何畫面會掛載。
import '../services/location';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';

export default function Layout() {
  return <SafeAreaProvider><Stack screenOptions={{headerShown: false}} /></SafeAreaProvider>;
}
