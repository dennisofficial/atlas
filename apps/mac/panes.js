const DEFAULT_PANE_ID = 'default'

export const PANE_TARGET_LIMIT = 8

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

export function createPaneRegistry({ create, release, limit = PANE_TARGET_LIMIT }) {
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
    const entry = { id, view: create(id), shownAt: ++clock }
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
    if (entry.view.webContents.getURL() === '') void entry.view.webContents.loadURL(command.url)
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
        void entry.view.webContents.loadURL(command.url)
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
