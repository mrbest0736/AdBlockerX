const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('adblockxBridge', {
  startServices: () => ipcRenderer.invoke('start-services'),
  stopServices: () => ipcRenderer.invoke('stop-services'),
  navigateContent: (url) => ipcRenderer.invoke('navigate-content', url),
  getContentUrl: () => ipcRenderer.invoke('get-content-url'),
  propagateSettings: (settings) => ipcRenderer.invoke('propagate-settings', settings),
  injectRuntime: () => ipcRenderer.invoke('inject-runtime'),
  setAutoInject: (flag) => ipcRenderer.invoke('set-auto-inject', !!flag)
  ,
  // network + filter controls
  toggleNetworkBlocking: (flag) => ipcRenderer.invoke('abx-toggle-network-blocking', !!flag),
  setFilters: (filters) => ipcRenderer.invoke('abx-set-filters', filters),
  getStats: () => ipcRenderer.invoke('abx-get-stats')
  ,
  // subscriptions & logs
  subsList: () => ipcRenderer.invoke('abx-subscriptions-list'),
  subsAdd: (s) => ipcRenderer.invoke('abx-subscriptions-add', s),
  subsRemove: (url) => ipcRenderer.invoke('abx-subscriptions-remove', url),
  getLogs: (limit) => ipcRenderer.invoke('abx-logs-get', limit),
  queryLogs: (opts) => ipcRenderer.invoke('abx-logs-query', opts)
  ,
  subsUpdateNow: () => ipcRenderer.invoke('abx-subscriptions-update-now'),
  filtersExport: () => ipcRenderer.invoke('abx-filters-export'),
  filtersImport: (filters) => ipcRenderer.invoke('abx-filters-import', filters),
  inspectorSummary: () => ipcRenderer.invoke('abx-inspector-summary')
  ,
  getLog: (id) => ipcRenderer.invoke('abx-log-get', id)
  ,
  // licensing endpoints
  checkoutProvider: (provider) => ipcRenderer.invoke('licensing-checkout', provider),
  restorePurchase: (proof) => ipcRenderer.invoke('licensing-restore', proof),
  getEntitlement: (userId) => ipcRenderer.invoke('licensing-entitlement', userId)
});

// allow the control UI to receive initial config from main
ipcRenderer.on('abx-initial-config', (event, data) => {
  try { window.dispatchEvent(new CustomEvent('abx:initial-config', { detail: data })); } catch(e) {}
});

// forward blocked events from main to the control UI
ipcRenderer.on('abx-blocked', (event, data) => {
  try { window.dispatchEvent(new CustomEvent('abx:block', { detail: data })); } catch(e) {}
});
