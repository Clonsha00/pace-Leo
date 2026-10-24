const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const config = getDefaultConfig(__dirname);
// 此手機專案直接讀取上層靜態網站的 core.js，維持一份算法來源。
config.watchFolders = [...config.watchFolders, path.resolve(__dirname, '..')];
module.exports = config;
