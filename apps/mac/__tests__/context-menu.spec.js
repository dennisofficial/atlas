import { describe, expect, mock, test } from 'bun:test'

import { contextMenuTemplate } from '../context-menu.js'

const noFlags = {
  canUndo: false,
  canRedo: false,
  canCut: false,
  canCopy: false,
  canPaste: false,
  canSelectAll: false,
}

function templateFor(params) {
  const actions = {
    openLink: mock(),
    copyText: mock(),
    copyImage: mock(),
    replaceMisspelling: mock(),
    learnSpelling: mock(),
  }
  return {
    actions,
    items: contextMenuTemplate({ params: { editFlags: noFlags, ...params }, ...actions }),
  }
}

const rolesOf = (items) => items.map((item) => item.role ?? item.label ?? item.type)

describe('contextMenuTemplate', () => {
  test('offers the edit commands in a text field, enabled by what the field allows', () => {
    const { items } = templateFor({
      isEditable: true,
      editFlags: { ...noFlags, canPaste: true, canSelectAll: true },
    })
    expect(rolesOf(items)).toEqual([
      'undo',
      'redo',
      'separator',
      'cut',
      'copy',
      'paste',
      'selectAll',
    ])
    expect(items.find((item) => item.role === 'paste')?.enabled).toBe(true)
    expect(items.find((item) => item.role === 'cut')?.enabled).toBe(false)
  })

  test('offers copy for selected page text', () => {
    const { items } = templateFor({ isEditable: false, selectionText: 'hello' })
    expect(rolesOf(items)).toEqual(['copy'])
  })

  test('shows nothing on plain page content', () => {
    expect(templateFor({ isEditable: false, selectionText: '' }).items).toEqual([])
  })

  test('opens and copies a web link', () => {
    const { items, actions } = templateFor({ linkURL: 'https://github.com/a', selectionText: 'a' })
    expect(rolesOf(items)).toEqual(['Open Link in Browser', 'Copy Link', 'separator', 'copy'])
    items[0]?.click?.()
    items[1]?.click?.()
    expect(actions.openLink).toHaveBeenCalledWith('https://github.com/a')
    expect(actions.copyText).toHaveBeenCalledWith('https://github.com/a')
  })

  test('copies an image and its web address', () => {
    const { items, actions } = templateFor({
      mediaType: 'image',
      srcURL: 'https://example.com/a.png',
      x: 10,
      y: 20,
    })
    expect(rolesOf(items)).toEqual(['Copy Image', 'Copy Image Address'])
    items[0]?.click?.()
    items[1]?.click?.()
    expect(actions.copyImage).toHaveBeenCalledWith({ x: 10, y: 20 })
    expect(actions.copyText).toHaveBeenCalledWith('https://example.com/a.png')
  })

  test('copies an inline image without offering its address', () => {
    const { items } = templateFor({ mediaType: 'image', srcURL: 'data:image/png;base64,AA==' })
    expect(rolesOf(items)).toEqual(['Copy Image'])
  })

  test('ignores a link the shell may not open', () => {
    expect(templateFor({ linkURL: 'javascript:alert(1)' }).items).toEqual([])
  })

  test('puts spelling suggestions first in a text field', () => {
    const { items, actions } = templateFor({
      isEditable: true,
      misspelledWord: 'teh',
      dictionarySuggestions: ['the', 'ten'],
    })
    expect(rolesOf(items).slice(0, 4)).toEqual(['the', 'ten', 'Learn Spelling', 'separator'])
    items[0]?.click?.()
    items[2]?.click?.()
    expect(actions.replaceMisspelling).toHaveBeenCalledWith('the')
    expect(actions.learnSpelling).toHaveBeenCalledWith('teh')
  })
})
