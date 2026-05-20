'use strict';

const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('path');

const isDev = !!process.env.ELECTRON_DEV;
let mainWindow = null;
let serverInfo = null;

async function startServer() {
  const { start } = require('../src/server');
  serverInfo = await start({ port: 0, host: '127.0.0.1' });
  return serverInfo;
}

function buildMenu() {
  const template = [
    {
      label: 'Datei',
      submenu: [
        {
          label: 'Schnell-Scan (24h)',
          accelerator: 'CmdOrCtrl+R',
          click: () =>
            mainWindow &&
            mainWindow.webContents.executeJavaScript(
              'document.getElementById("quick-scan")?.click()'
            ),
        },
        { type: 'separator' },
        {
          label: 'Reports-Ordner oeffnen',
          click: () => {
            const reportsDir = path.resolve(__dirname, '..', 'reports');
            shell.openPath(reportsDir);
          },
        },
        {
          label: 'Daten-Ordner oeffnen',
          click: () => {
            const dataDir = path.resolve(__dirname, '..', 'data');
            shell.openPath(dataDir);
          },
        },
        { type: 'separator' },
        { role: 'quit', label: 'Beenden' },
      ],
    },
    {
      label: 'Bearbeiten',
      submenu: [
        { role: 'undo', label: 'Rueckgaengig' },
        { role: 'redo', label: 'Wiederholen' },
        { type: 'separator' },
        { role: 'cut', label: 'Ausschneiden' },
        { role: 'copy', label: 'Kopieren' },
        { role: 'paste', label: 'Einfuegen' },
        { role: 'selectAll', label: 'Alles markieren' },
      ],
    },
    {
      label: 'Ansicht',
      submenu: [
        { role: 'reload', label: 'Neu laden' },
        { role: 'forceReload', label: 'Hart neu laden' },
        { role: 'toggleDevTools', label: 'DevTools', visible: isDev },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Zoom zuruecksetzen' },
        { role: 'zoomIn', label: 'Zoom +' },
        { role: 'zoomOut', label: 'Zoom -' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Vollbild' },
      ],
    },
    {
      label: 'Hilfe',
      submenu: [
        {
          label: 'Ueber Pressespiegel',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Pressespiegel Kammerspiele',
              message: 'Pressespiegel Kammerspiele',
              detail: `Version: ${app.getVersion()}\nNode: ${process.versions.node}\nElectron: ${process.versions.electron}\n\nAlle Daten bleiben lokal.\nKeine Cloud, kein E-Mail.`,
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow() {
  const { width, height } = require('electron').screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    width: Math.min(1400, width - 40),
    height: Math.min(900, height - 40),
    minWidth: 900,
    minHeight: 600,
    title: 'Pressespiegel Kammerspiele',
    backgroundColor: '#0b1120',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    show: false,
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`http://${serverInfo.host}:${serverInfo.port}`)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  await mainWindow.loadURL(`http://${serverInfo.host}:${serverInfo.port}/`);
}

app.whenReady().then(async () => {
  try {
    await startServer();
    buildMenu();
    await createWindow();
  } catch (err) {
    dialog.showErrorBox('Start-Fehler', err.stack || err.message);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) await createWindow();
});

process.on('unhandledRejection', (err) => {
  console.error('UnhandledRejection:', err);
});
