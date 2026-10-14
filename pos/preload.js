const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pos", {
  load: () => ipcRenderer.invoke("store:load"),
  save: (store) => ipcRenderer.invoke("store:save", store),
  backupNow: (store) => ipcRenderer.invoke("backup:now", store),
  chooseBackupFolder: () => ipcRenderer.invoke("backup:choose"),
  openBackupFolder: (store) => ipcRenderer.invoke("backup:open", store),
  restoreBackup: () => ipcRenderer.invoke("backup:restore"),
  saveCsv: (name, csv) => ipcRenderer.invoke("csv:save", { name, csv }),
  printReceipt: (html, paper) => ipcRenderer.invoke("receipt:print", { html, paper }),
  emailReceipt: (opts) => ipcRenderer.invoke("receipt:email", opts),
  fetchProducts: (base) => ipcRenderer.invoke("web:products", base),
  info: () => ipcRenderer.invoke("app:info"),
});
