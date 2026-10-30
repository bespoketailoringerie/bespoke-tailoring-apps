// Bespoke Post Studio for Windows: a window around app/index.html, a Save dialog for finished
// images and PDFs, and a check for new versions (published as studio-v1.2.3 releases in this repo).
const { app, BrowserWindow, ipcMain, dialog, shell, net } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");

const REPO = "bespoketailoringerie/bespoke-tailoring-apps";
let win = null;

if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600,
    backgroundColor: "#f7eeda", title: "Bespoke Post Studio", show: false,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true },
  });
  win.removeMenu();
  win.once("ready-to-show", () => { win.maximize(); win.show(); });
  win.loadFile(path.join(__dirname, "app", "index.html"));
  // Web links open in the normal browser; the app window never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { e.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); });
  win.on("closed", () => { win = null; });
}

const FILTERS = { png: [{ name: "PNG image", extensions: ["png"] }], pdf: [{ name: "PDF", extensions: ["pdf"] }] };
ipcMain.handle("save-file", async (_e, { filename, data }) => {
  const name = path.basename(String(filename || "design.png")).replace(/[<>:"/\\|?*]+/g, "-");
  const ext = path.extname(name).slice(1).toLowerCase();
  const r = await dialog.showSaveDialog(win, { title: "Save your design", defaultPath: path.join(app.getPath("documents"), name), filters: FILTERS[ext] || [] });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  await fs.writeFile(r.filePath, Buffer.from(data));
  return { ok: true, path: r.filePath };
});
ipcMain.handle("version", () => app.getVersion());

// ---- New versions ----
const newer = (a, b) => {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};
let offered = "";
async function checkForUpdate() {
  try {
    const res = await net.fetch(`https://api.github.com/repos/${REPO}/releases?per_page=40`, { headers: { accept: "application/vnd.github+json", "user-agent": "bespoke-post-studio" } });
    if (!res.ok) return;
    const rel = (await res.json()).find((r) => !r.draft && !r.prerelease && /^studio-v\d+\.\d+\.\d+$/.test(r.tag_name));
    if (!rel) return;
    const v = rel.tag_name.slice("studio-v".length);
    if (!newer(v, app.getVersion()) || offered === v || !win) return;
    offered = v;
    const exe = (rel.assets || []).find((a) => /\.exe$/i.test(a.name));
    const r = await dialog.showMessageBox(win, {
      type: "info", buttons: ["Download it", "Later"], defaultId: 0, cancelId: 1,
      title: "New version of Post Studio", message: `Post Studio ${v} is ready.`,
      detail: "Download the new installer and run it. Your saved designs and photos stay where they are.",
    });
    if (r.response === 0) shell.openExternal(exe ? exe.browser_download_url : rel.html_url);
  } catch { /* no internet: try again later */ }
}

app.whenReady().then(() => {
  createWindow();
  if (app.isPackaged) { setTimeout(checkForUpdate, 8000); setInterval(checkForUpdate, 6 * 60 * 60 * 1000); }
});
app.on("window-all-closed", () => app.quit());
