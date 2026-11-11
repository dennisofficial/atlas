// Electron's runtime cannot load TypeScript, so the shell keeps its own copy of these names; a spec
// holds them equal to EDesktopUpdateState in src/host/update-routes.ts.
export const IDLE = 'idle'
export const READY = 'ready'
export const RESTARTING = 'restarting'

export const UPDATE_STATUS_PATH = '/update/status'
export const UPDATE_CHECK_PATH = '/update/check'
export const UPDATE_RESTART_PATH = '/update/restart'

export const BINARY_UPDATE_INTERVAL_MS = 30 * 60 * 1000

const messageOf = (error) => (error instanceof Error ? error.message : String(error))

const versionOf = (info) => (typeof info?.version === 'string' ? info.version : undefined)

export function createBinaryUpdater({
  autoUpdater,
  enabled,
  intervalMs = BINARY_UPDATE_INTERVAL_MS,
}) {
  let state = { state: IDLE }
  let timer

  const check = async () => {
    if (!enabled) return state
    await autoUpdater.checkForUpdates().catch((error) => {
      console.error('[app-update]', error)
    })
    return state
  }

  const stop = () => {
    if (timer === undefined) return
    clearInterval(timer)
    timer = undefined
  }

  if (enabled) {
    autoUpdater.on('update-downloaded', (info) => {
      const version = versionOf(info)
      state = version === undefined ? { state: READY } : { state: READY, version }
    })
    autoUpdater.on('error', (error) => {
      state = { state: IDLE, error: messageOf(error) }
    })
  }

  return {
    status: () => state,
    check,
    start: () => {
      if (!enabled) return
      void check()
      if (timer !== undefined) return
      timer = setInterval(() => void check(), intervalMs)
    },
    stop,
    restart: async () => {
      if (!enabled) throw new Error('app updates need a packaged build')
      state = state.version === undefined ? { state: RESTARTING } : { ...state, state: RESTARTING }
      autoUpdater.quitAndInstall()
    },
  }
}

export function createDesktopUpdates({ payloads, binary }) {
  const snapshot = async () => ({ ...binary.status(), web: payloads.updater.status() })

  return {
    status: snapshot,
    check: async () => {
      await payloads.check()
      await binary.check()
      return snapshot()
    },
    restart: async () => {
      const hash = payloads.updater.pending()
      if (hash !== undefined) return payloads.swap({ hash })
      if (binary.status().state !== READY) throw new Error('no update is ready')
      await binary.restart()
    },
  }
}

const readyOf = (status) => status.state === READY || status.web?.state === READY

export function answerUpdate({ updates, request, pathname }) {
  if (pathname === UPDATE_STATUS_PATH && request.method === 'GET')
    return updates.status().then((body) => ({ status: 200, body }))
  if (pathname === UPDATE_CHECK_PATH && request.method === 'POST')
    return updates.check().then(
      (body) => ({ status: 200, body }),
      (error) => ({ status: 200, body: { state: IDLE, error: messageOf(error) } }),
    )
  if (pathname === UPDATE_RESTART_PATH && request.method === 'POST')
    return updates.status().then((status) => {
      if (!readyOf(status)) return { status: 409, body: { message: 'No update is ready' } }
      void updates.restart().catch((error) => console.error('[updates]', error))
      return { status: 202, body: null }
    })
  return undefined
}
