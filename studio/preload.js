// What the Post Studio page can ask the Windows app to do. The page checks for window.studio and
// otherwise behaves as it does in a browser.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("studio", {
  saveFile: (filename, data) => ipcRenderer.invoke("save-file", { filename, data }),
  version: () => ipcRenderer.invoke("version"),
});
