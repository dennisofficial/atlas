const DEFAULT_PANE_ID = 'default'

// One view per preview tab, kept alive for as long as the target exists: switching a session or a
// tab is a visibility change, never a reload. The cap is memory, not policy — past it the least
// recently shown view is destroyed, which is the only way a tab ever loses its page.
export const PANE_TARGET_LIMIT = 20

const ERR_ABORTED = -3

export function paneTargetOf(command) {
  return typeof command.id === 'string' && command.id !== '' ? command.id : DEFAULT_PANE_ID
}

function validRect(rect) {
  return (
    typeof rect === 'object' &&
    rect !== null &&
    ['x', 'y', 'width', 'height'].every((key) => typeof rect[key] === 'number')
  )
}

export function validCommand(command) {
  if (typeof command !== 'object' || command === null) return false
  if (command.id !== undefined && typeof command.id !== 'string') return false
  switch (command.kind) {
    case 'show':
      return typeof command.url === 'string' && validRect(command.rect)
    case 'hide':
    case 'back':
    case 'forward':
    case 'reload':
    case 'stop':
      return true
    case 'setRect':
      return validRect(command.rect)
    case 'navigate':
      return typeof command.url === 'string'
    case 'setObscured':
      return typeof command.obscured === 'boolean'
    default:
      return false
  }
}

function loadInto({ entry, url }) {
  entry.requested = url
  entry.view.webContents.loadURL(url).catch((error) => {
    console.error(`[pane] ${url} did not load`, error)
  })
}

function watchNavigation({ id, webContents, onNavigate, onTitle }) {
  webContents.on('did-navigate', (_event, url) => onNavigate({ id, url }))
  webContents.on('did-fail-load', (_event, errorCode, errorDescription, failedUrl, isMainFrame) => {
    if (!isMainFrame || errorCode === ERR_ABORTED) return
    console.error(`[pane] ${failedUrl} answered ${errorCode} ${errorDescription}`)
    // The view keeps whatever it was showing, so tell the interface where it actually is instead of
    // leaving an address bar that names a page nobody can see.
    const at = webContents.getURL()
    if (at !== '') onNavigate({ id, url: at })
  })
  webContents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    if (isMainFrame) onNavigate({ id, url })
  })
  webContents.on('page-title-updated', (_event, title) => onTitle({ id, title }))
}

export function createPaneRegistry({
  create,
  release,
  limit = PANE_TARGET_LIMIT,
  onNavigate = () => undefined,
  onTitle = () => undefined,
}) {
  const held = new Map()
  let clock = 0

  const trim = () => {
    while (held.size > limit) {
      let victim
      for (const entry of held.values()) {
        if (victim === undefined || entry.shownAt < victim.shownAt) victim = entry
      }
      if (victim === undefined) return
      held.delete(victim.id)
      release(victim.view)
    }
  }

  const createFor = (id) => {
    const view = create(id)
    watchNavigation({ id, webContents: view.webContents, onNavigate, onTitle })
    const entry = { id, view, shownAt: ++clock, requested: undefined }
    held.set(id, entry)
    trim()
    return held.get(id) ?? entry
  }

  const show = (command) => {
    const id = paneTargetOf(command)
    for (const [otherId, other] of held) {
      if (otherId !== id) other.view.setVisible(false)
    }
    const entry = held.get(id) ?? createFor(id)
    if (entry.requested !== command.url) loadInto({ entry, url: command.url })
    entry.view.setBounds(command.rect)
    entry.view.setVisible(true)
    entry.shownAt = ++clock
  }

  const apply = (command) => {
    if (command.kind === 'show') {
      show(command)
      return
    }
    const entry = held.get(paneTargetOf(command))
    if (entry === undefined) return
    switch (command.kind) {
      case 'hide':
        entry.view.setVisible(false)
        break
      case 'setRect':
        entry.view.setBounds(command.rect)
        break
      case 'navigate':
        loadInto({ entry, url: command.url })
        break
      case 'back':
        entry.view.webContents.navigationHistory.goBack()
        break
      case 'forward':
        entry.view.webContents.navigationHistory.goForward()
        break
      case 'reload':
        entry.view.webContents.reload()
        break
      case 'stop':
        entry.view.webContents.stop()
        break
      case 'setObscured':
        entry.view.setVisible(!command.obscured)
        break
    }
  }

  return {
    apply,
    size: () => held.size,
    ids: () => [...held.keys()],
    destroy: () => {
      for (const entry of held.values()) release(entry.view)
      held.clear()
    },
  }
}
