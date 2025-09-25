const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('adblockxBridge', {
  startServices: () => ipcRenderer.invoke('start-services'),
  stopServices: () => ipcRenderer.invoke('stop-services'),
  navigateContent: (url) => ipcRenderer.invoke('navigate-content', url),
  getContentUrl: () => ipcRenderer.invoke('get-content-url')
});
