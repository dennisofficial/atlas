import { app, BrowserWindow, WebContentsView } from 'electron'

const START_URL = process.env.ATLAS_URL ?? 'https://example.com'
const PANE_URL = 'https://google.com'
const PANE_PARTITION = 'persist:spike'
const WINDOW_WIDTH = 1280
const WINDOW_HEIGHT = 820
const PANE_SHARE = 0.5

function paneBounds({ width, height }) {
  const paneWidth = Math.round(width * PANE_SHARE)
  return { x: width - paneWidth, y: 0, width: paneWidth, height }
}

function createWindow() {
  const win = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    resizable: true,
    titleBarStyle: 'hiddenInset',
  })

  const pane = new WebContentsView({
    webPreferences: { partition: PANE_PARTITION, contextIsolation: true },
  })
  win.contentView.addChildView(pane)

  const layoutPane = () => {
    const [width, height] = win.getContentSize()
    pane.setBounds(paneBounds({ width, height }))
  }

  win.on('resize', layoutPane)
  win.on('closed', () => {
    pane.webContents.close()
  })

  layoutPane()
  win.loadURL(START_URL)
  pane.webContents.loadURL(PANE_URL)

  return win
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
