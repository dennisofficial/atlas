import { urlForSession } from './apns.js'
import { inPagePlanOf } from './page-navigation.js'

export const REFRESH_GAPS_MS = [0, 1_000, 4_000]

export const EClickPlan = Object.freeze({
  Defer: 'defer',
  Focus: 'focus',
  Navigate: 'navigate',
  NavigateInPage: 'navigate-in-page',
})

const PAGE_PROTOCOLS = new Set(['http:', 'https:'])

const pageOriginOf = (pageUrl) => {
  try {
    const url = new URL(pageUrl)
    return PAGE_PROTOCOLS.has(url.protocol) ? url.origin : undefined
  } catch {
    return undefined
  }
}

export const sessionIdOfDelivered = (notification) => {
  const groupId = notification?.groupId
  return typeof groupId === 'string' && groupId.length > 0 ? groupId : undefined
}

export const clickPlanOf = ({ sessionId, pageUrl, appUrl, loading = false }) => {
  const origin = pageOriginOf(appUrl)
  if (loading || origin === undefined) return { kind: EClickPlan.Defer }
  return inPagePlanOf({ pageUrl, url: urlForSession(origin, sessionId), kinds: EClickPlan })
}

export function revealWindow({ app, win }) {
  app.show()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

export function createSessionOpener({ app, windowNow, createWindow, navigation }) {
  const reveal = (win) => revealWindow({ app, win })

  const navigate = (win, sessionId) => {
    const plan = clickPlanOf({
      sessionId,
      pageUrl: win.webContents.getURL(),
      appUrl: navigation.urlOf(win),
      loading: win.webContents.isLoading(),
    })
    if (plan.kind === EClickPlan.Navigate) void win.loadURL(plan.url)
    if (plan.kind === EClickPlan.NavigateInPage) void navigation.navigate({ win, ...plan })
    return plan.kind
  }

  return (sessionId) => {
    const win = windowNow()
    if (win === undefined) {
      void createWindow({ sessionId })
      return
    }
    reveal(win)
    if (navigate(win, sessionId) !== EClickPlan.Defer) return
    win.webContents.once('did-finish-load', () => {
      if (!win.isDestroyed()) navigate(win, sessionId)
    })
  }
}

const waitFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function createClickWatcher({ notifications, onClick, wait = waitFor, log = () => {} }) {
  const watched = new Map()
  let queue = Promise.resolve()

  const watch = (notification) => {
    const sessionId = sessionIdOfDelivered(notification)
    if (sessionId === undefined) {
      notification.close()
      return
    }
    notification.on('click', () => {
      watched.delete(notification.id)
      onClick(sessionId)
    })
    watched.set(notification.id, notification)
  }

  const sync = async () => {
    const delivered = await notifications.getHistory()
    const deliveredIds = new Set(delivered.map((notification) => notification.id))
    for (const [id, notification] of watched) {
      if (deliveredIds.has(id)) continue
      watched.delete(id)
      notification.close()
    }
    for (const notification of delivered) {
      if (watched.has(notification.id)) notification.close()
      else watch(notification)
    }
  }

  const refresh = () => {
    queue = queue.then(sync).catch((error) => log(`[notification-clicks] refresh failed: ${error}`))
    return queue
  }

  const refreshSoon = async () => {
    for (const gap of REFRESH_GAPS_MS) {
      if (gap > 0) await wait(gap)
      await refresh()
    }
  }

  return {
    refresh,
    refreshSoon,
    watchedCount: () => watched.size,
    start: ({ pushes, app }) => {
      pushes.on('received-apns-notification', () => void refreshSoon())
      app.on('did-resign-active', () => void refresh())
      return refresh()
    },
  }
}
