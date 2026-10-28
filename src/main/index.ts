import { app, BrowserWindow, session } from 'electron'
import { join } from 'node:path'
import { openExternalSafe, registerIpc } from './ipc'

// Lets automated tests run with a throwaway settings folder.
if (process.env.LS_USER_DATA_DIR) app.setPath('userData', process.env.LS_USER_DATA_DIR)

let mainWindow: BrowserWindow | null = null

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: 'Literature Screener',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.once('ready-to-show', () => win.show())

  // Links never open inside the app; https links go to the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) {
      event.preventDefault()
      openExternalSafe(url)
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  win.on('closed', () => {
    mainWindow = null
  })
  mainWindow = win
}

app.whenReady().then(() => {
  // The app never needs camera, microphone, notifications, etc.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))

  const { closeProject } = registerIpc(() => mainWindow)
  app.on('before-quit', closeProject)

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => app.quit())
