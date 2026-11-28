import { sameOrigin } from './links.js'

export const PAGE_NAVIGATE = 'atlas-desktop:navigate'
export const NAVIGATION_ACK_MS = 1_000

export function inPagePlanOf({ pageUrl, url, kinds }) {
  if (url === pageUrl) return { kind: kinds.Focus }
  if (!sameOrigin(pageUrl, url)) return { kind: kinds.Navigate, url }
  const target = new URL(url)
  return {
    kind: kinds.NavigateInPage,
    path: `${target.pathname}${target.search}${target.hash}`,
    url,
  }
}

export function createPageNavigation({ ipcMain, timeoutMs = NAVIGATION_ACK_MS, log = () => {} }) {
  const pages = new WeakMap()
  const pending = new Map()
  let requestId = 0

  ipcMain.on(PAGE_NAVIGATE, (event, reply) => {
    const request = pending.get(event.sender)
    if (request !== undefined && request.id === reply?.requestId) request.finish(true)
  })

  const requestNavigation = ({ win, path }) =>
    new Promise((resolve) => {
      const contents = win.webContents
      pending.get(contents)?.finish(true)
      const id = ++requestId
      const finish = (accepted) => {
        clearTimeout(timer)
        contents.removeListener('destroyed', handleDestroyed)
        pending.delete(contents)
        resolve(accepted)
      }
      const handleDestroyed = () => finish(true)
      const timer = setTimeout(() => finish(false), timeoutMs)
      pending.set(contents, { id, finish })
      contents.once('destroyed', handleDestroyed)
      try {
        contents.send(PAGE_NAVIGATE, { requestId: id, path })
      } catch {
        finish(false)
      }
    })

  return {
    urlOf: (win) => pages.get(win),
    load: async ({ win, url }) => {
      const previous = pages.get(win)
      pages.set(win, url)
      try {
        await win.loadURL(url)
      } catch (error) {
        if (previous !== undefined) pages.set(win, previous)
        throw error
      }
    },
    navigate: async ({ win, path, url }) => {
      if (win.isDestroyed()) return
      const accepted = await requestNavigation({ win, path })
      if (accepted || win.isDestroyed()) return
      try {
        await win.loadURL(url)
      } catch (error) {
        log(`[navigation] could not load ${url}: ${error}`)
      }
    },
  }
}
