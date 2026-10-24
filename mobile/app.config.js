const iosKey = process.env.GOOGLE_MAPS_IOS_API_KEY;
const androidKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY;

module.exports = {
  expo: {
    name: 'PACE 運動', slug: 'paceleo-mobile', version: '0.1.0', scheme: 'pacemobile',
    orientation: 'portrait', userInterfaceStyle: 'light', icon: './assets/icon.png',
    ios: {supportsTablet: false, bundleIdentifier: 'com.paceleo.mobile',
      infoPlist: {ITSAppUsesNonExemptEncryption: false}},
    android: {package: 'com.paceleo.mobile'},
    plugins: [
      'expo-router', 'expo-dev-client', 'expo-sqlite', 'expo-sharing',
      ['expo-location', {
        locationWhenInUsePermission: 'PACE 需要位置以記錄你開始的運動路線。',
        locationAlwaysAndWhenInUsePermission: '運動記錄期間，PACE 需要在鎖屏或切換 App 後繼續記錄路線。暫停或結束後會停止定位。',
        isIosBackgroundLocationEnabled: true,
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      }],
      ...((iosKey || androidKey) ? [['react-native-maps', {
        ...(iosKey ? {iosGoogleMapsApiKey: iosKey} : {}),
        ...(androidKey ? {androidGoogleMapsApiKey: androidKey} : {}),
      }]] : []),
    ],
    extra: {
      eas: {projectId: '46882e8c-b1b5-4968-a6be-d8558626db70'},
      googleMapsConfigured: {ios: !!iosKey, android: !!androidKey},
    },
  },
};
