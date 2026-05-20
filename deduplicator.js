'use strict';

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('pressespiegel', {
  isElectron: true,
  version: process.versions.electron,
  platform: process.platform,
});
