// Bespoke Register: desktop app shell. Keeps the shop's data in one file on this computer,
// prints and emails receipts, and reads the item list from the website Shop.
const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

let win;
const dataDir = () => app.getPath("userData");
const dataFile = () => path.join(dataDir(), "register-data.json");

function readStore() {
  for (const f of [dataFile(), dataFile() + ".bak"]) {
    try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch {}
  }
  return null;
}

// Write to a temp file first, then swap it in, so a power cut can't leave a half-written file.
function writeStore(store) {
  const f = dataFile();
  const tmp = f + ".tmp";
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(store));
  if (fs.existsSync(f)) fs.copyFileSync(f, f + ".bak");
  fs.renameSync(tmp, f);
  dailyBackup(store);
}

function backupFolder(store) {
  return (store && store.settings && store.settings.backupFolder) || path.join(dataDir(), "backups");
}

// One copy per day, kept for 60 days.
function dailyBackup(store, force) {
  try {
    const dir = backupFolder(store);
    fs.mkdirSync(dir, { recursive: true });
    const name = `register-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const target = path.join(dir, name);
    if (!force && fs.existsSync(target) && Date.now() - fs.statSync(target).mtimeMs < 60 * 60 * 1000) return target;
    fs.writeFileSync(target, JSON.stringify(store));
    const old = fs.readdirSync(dir).filter((n) => /^register-backup-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort();
    for (const n of old.slice(0, Math.max(0, old.length - 60))) fs.unlinkSync(path.join(dir, n));
    return target;
  } catch (e) {
    return null;
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1100,
    minHeight: 700,
    title: "Bespoke Register",
    backgroundColor: "#f7eeda",
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, "app", "index.html"));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
}

ipcMain.handle("store:load", () => readStore());
ipcMain.handle("store:save", (_e, store) => { writeStore(store); return true; });

ipcMain.handle("backup:now", (_e, store) => {
  const f = dailyBackup(store, true);
  return f ? { ok: true, file: f } : { ok: false, error: "Couldn't write the backup. Check that the backup folder exists and isn't full." };
});
ipcMain.handle("backup:choose", async () => {
  const r = await dialog.showOpenDialog(win, { title: "Choose a backup folder", properties: ["openDirectory", "createDirectory"] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle("backup:open", (_e, store) => shell.openPath(backupFolder(store)));
ipcMain.handle("backup:restore", async () => {
  const r = await dialog.showOpenDialog(win, { title: "Choose a backup to restore", filters: [{ name: "Register backup", extensions: ["json"] }] });
  if (r.canceled) return null;
  try { return JSON.parse(fs.readFileSync(r.filePaths[0], "utf8")); } catch { return { error: "That file isn't a register backup." }; }
});

ipcMain.handle("csv:save", async (_e, { name, csv }) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: name, filters: [{ name: "Spreadsheet (CSV)", extensions: ["csv"] }] });
  if (r.canceled) return null;
  fs.writeFileSync(r.filePath, "﻿" + csv);
  return r.filePath;
});

// Print a receipt: a hidden window loads the receipt page and opens the printer dialog.
ipcMain.handle("receipt:print", async (_e, { html, paper }) => {
  const pw = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  // Load the receipt from a file next to the app's bundled fonts, so it prints in the shop's typefaces.
  const fontsCss = require("node:url").pathToFileURL(path.join(__dirname, "app", "fonts", "fonts.css")).href;
  const page = path.join(app.getPath("temp"), "bespoke-print.html");
  fs.writeFileSync(page, String(html).replace(/<head>/i, `<head><link rel="stylesheet" href="${fontsCss}">`));
  await pw.loadFile(page);
  await pw.webContents.executeJavaScript("document.fonts.ready.then(() => true)").catch(() => {});
  const pageSize = paper === "letter" ? "Letter" : { width: 80000, height: 297000 };
  return new Promise((resolve) => {
    pw.webContents.print({ silent: false, printBackground: true, pageSize, margins: { marginType: "none" } }, (ok, reason) => {
      pw.destroy();
      resolve(ok ? { ok: true } : { ok: false, error: reason === "cancelled" ? "" : "The printer didn't respond. Check that it's on and connected." });
    });
  });
});

// Email a receipt through the shop's Gmail account (needs a Google app password, set in Settings).
ipcMain.handle("receipt:email", async (_e, { to, subject, html, user, pass, fromName }) => {
  if (!user || !pass) return { ok: false, error: "Add the shop's Gmail address and app password in Settings first." };
  try {
    const nodemailer = require("nodemailer");
    const t = nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
    await t.sendMail({ from: `"${String(fromName || "Bespoke Tailoring").replace(/"/g, "")}" <${user}>`, to, subject, html });
    return { ok: true };
  } catch (e) {
    const msg = String(e && e.message || "");
    if (/Invalid login|535|Username and Password/i.test(msg)) return { ok: false, error: "Gmail didn't accept the sign-in. Check the address and app password in Settings." };
    if (/ENOTFOUND|ETIMEDOUT|ECONNREFUSED|getaddrinfo/i.test(msg)) return { ok: false, error: "The computer isn't online, so the receipt wasn't sent. Try again when the internet is back." };
    return { ok: false, error: "The receipt wasn't sent: " + msg.slice(0, 140) };
  }
});

// Read the public item list from the website Shop.
ipcMain.handle("web:products", async (_e, base) => {
  try {
    const url = String(base || "").replace(/\/+$/, "") + "/api/products";
    const r = await fetch(url, { headers: { accept: "application/json" } });
    if (!r.ok) return { ok: false, error: `The website answered with an error (${r.status}).` };
    const j = await r.json();
    return { ok: true, products: Array.isArray(j.products) ? j.products : [] };
  } catch {
    return { ok: false, error: "Couldn't reach the website. Check the internet connection and the website address in Settings." };
  }
});

ipcMain.handle("app:info", () => ({ version: app.getVersion(), dataFile: dataFile(), installed: true }));

// Cash drawer on a USB trigger (e.g. Volcora): Windows shows the trigger as a serial (COM) port, and
// sending it a few bytes pops the drawer. Done through Windows PowerShell so no extra modules are needed.
const { execFile } = require("node:child_process");
function powershell(script, timeout = 10000) {
  return new Promise((resolve) => {
    if (process.platform !== "win32") return resolve({ ok: false, out: "", err: "Only on the shop's Windows computer." });
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { timeout, windowsHide: true }, (e, out, err) => resolve({ ok: !e, out: String(out || ""), err: String(err || (e && e.message) || "") }));
  });
}
ipcMain.handle("drawer:ports", async () => {
  const r = await powershell(
    "$ErrorActionPreference='SilentlyContinue';" +
    "$n=@(Get-CimInstance Win32_PnPEntity | Where-Object { $_.Name -match '\\(COM\\d+\\)' } | ForEach-Object { $_.Name });" +
    "$p=@([System.IO.Ports.SerialPort]::GetPortNames());" +
    "[pscustomobject]@{names=$n;ports=$p} | ConvertTo-Json -Compress");
  if (!r.ok) return { ok: false, ports: [], error: r.err.includes("Windows") ? r.err : "Couldn't list the computer's ports." };
  let j = {}; try { j = JSON.parse(r.out.trim() || "{}"); } catch {}
  const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  const ports = new Map();
  for (const name of arr(j.names)) { const m = /\((COM\d+)\)/i.exec(name); if (m) ports.set(m[1].toUpperCase(), name); }
  for (const p of arr(j.ports)) if (/^COM\d+$/i.test(p) && !ports.has(p.toUpperCase())) ports.set(p.toUpperCase(), p.toUpperCase());
  return { ok: true, ports: [...ports].map(([port, name]) => ({ port, name })).sort((a, b) => Number(a.port.slice(3)) - Number(b.port.slice(3))) };
});
let drawerBusy = null;
ipcMain.handle("drawer:open", async (_e, port) => {
  const p = String(port || "").toUpperCase();
  if (!/^COM\d{1,3}$/.test(p)) return { ok: false, error: "Choose the cash drawer's port in Settings first." };
  if (drawerBusy) return drawerBusy;
  drawerBusy = (async () => {
    const r = await powershell(
      "$ErrorActionPreference='Stop';" +
      `$s=New-Object System.IO.Ports.SerialPort '${p}',9600,'None',8,'One';` +
      "$s.WriteTimeout=2000;$s.DtrEnable=$true;$s.RtsEnable=$true;" +
      "try{$s.Open();$b=[byte[]](0x55,0x55,0x55,0x55,0x55,0x55,0x55,0x55);$s.Write($b,0,$b.Length);Start-Sleep -Milliseconds 150}" +
      "catch{[Console]::Error.Write($_.Exception.Message);exit 1}finally{if($s.IsOpen){$s.Close()}}");
    if (r.ok) return { ok: true };
    const msg = r.err;
    if (/does not exist|not exist|cannot find/i.test(msg)) return { ok: false, error: `${p} isn't connected. Check the drawer's USB plug, then choose its port again in Settings.` };
    if (/denied|in use/i.test(msg)) return { ok: false, error: `${p} is busy. Close any other program using the drawer (like its test tool), then try again.` };
    return { ok: false, error: "The drawer didn't open. Check its USB plug and the port in Settings." };
  })();
  try { return await drawerBusy; } finally { drawerBusy = null; }
});

// Updates: new versions are published on GitHub (bespoketailoringerie/bespoke-tailoring-apps).
// The app checks when it opens and every few hours, downloads a new version in the background,
// then asks before restarting so a sale is never interrupted.
function setupUpdates() {
  if (!app.isPackaged) return;
  let autoUpdater;
  try { ({ autoUpdater } = require("electron-updater")); } catch { return; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("update-downloaded", async (info) => {
    const r = await dialog.showMessageBox(win, {
      type: "info",
      title: "Update ready",
      message: `Bespoke Register ${info.version} is ready to install.`,
      detail: "Restart now to update, or choose Later and it will update the next time the register is closed.",
      buttons: ["Restart now", "Later"],
      defaultId: 1,
      cancelId: 1,
    });
    if (r.response === 0) autoUpdater.quitAndInstall();
  });
  autoUpdater.on("error", () => {}); // no internet or GitHub unreachable: try again later
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 10 * 1000);
  setInterval(check, 4 * 60 * 60 * 1000);
}

app.whenReady().then(() => { createWindow(); setupUpdates(); });
app.on("window-all-closed", () => app.quit());
