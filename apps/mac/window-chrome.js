import { clipboard, Menu, shell } from 'electron'

import { contextMenuTemplate } from './context-menu.js'
import { browserUrlOf } from './links.js'

export function openInBrowser(url) {
  const external = browserUrlOf(url)
  if (external !== null) void shell.openExternal(external)
}

export function sendToBrowser({ event, url }) {
  event.preventDefault()
  if (url !== null) void shell.openExternal(url)
}

export function denyWindow(url) {
  openInBrowser(url)
  return { action: 'deny' }
}

export function attachContextMenu({ win, contents }) {
  contents.on('context-menu', (_event, params) => {
    const template = contextMenuTemplate({
      params,
      openLink: openInBrowser,
      copyText: (text) => clipboard.writeText(text),
      copyImage: ({ x, y }) => contents.copyImageAt(x, y),
      replaceMisspelling: (word) => contents.replaceMisspelling(word),
      learnSpelling: (word) => contents.session.addWordToSpellCheckerDictionary(word),
    })
    if (template.length === 0) return
    Menu.buildFromTemplate(template).popup({ window: win })
  })
}
