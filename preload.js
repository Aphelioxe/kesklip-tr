'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

function subscribe(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, payload) => {
    try {
      callback(payload);
    } catch (error) {
      console.error(`KesKlip ${channel} dinleyicisi:`, error);
    }
  };
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('kesklip', {
  info: () => ipcRenderer.invoke('app:info'),
  getMediaUrl: (filePath) => ipcRenderer.invoke('app:getMediaUrl', filePath),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),

  pickMedia: (kind) => ipcRenderer.invoke('media:pick', { kind }),
  probeMedia: (filePath) => ipcRenderer.invoke('media:probe', filePath),
  createThumbnail: (media) => ipcRenderer.invoke('media:thumbnail', media),
  preparePreview: (media) => ipcRenderer.invoke('media:preparePreview', media),
  checkPaths: (filePaths) => ipcRenderer.invoke('media:checkPaths', filePaths),
  showInFolder: (filePath) => ipcRenderer.invoke('media:showInFolder', filePath),

  saveProject: (payload) => ipcRenderer.invoke('project:save', payload),
  openProject: () => ipcRenderer.invoke('project:open'),
  autosaveProject: (data) => ipcRenderer.invoke('project:autosave', data),
  getAutosave: () => ipcRenderer.invoke('project:getAutosave'),
  clearAutosave: () => ipcRenderer.invoke('project:clearAutosave'),

  chooseExportPath: (options) => ipcRenderer.invoke('export:choosePath', options),
  startExport: (payload) => ipcRenderer.invoke('export:start', payload),
  cancelExport: () => ipcRenderer.invoke('export:cancel'),

  openPath: (filePath) => ipcRenderer.invoke('shell:openPath', filePath),
  showItemInFolder: (filePath) => ipcRenderer.invoke('shell:showItemInFolder', filePath),

  onProxyUpdate: (callback) => subscribe('proxy:update', callback),
  onExportProgress: (callback) => subscribe('export:progress', callback),
  onExportStarted: (callback) => subscribe('export:started', callback),

  getPathForFile: (file) => {
    try {
      if (webUtils && typeof webUtils.getPathForFile === 'function') {
        return webUtils.getPathForFile(file) || '';
      }
      return file.path || '';
    } catch {
      return file.path || '';
    }
  },
});
