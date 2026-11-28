import { describe, expect, it } from 'bun:test'

import {
  accessFileEditorDirty,
  accessFileEditorOf,
  clearAccessFileEditor,
  loadAccessFileEditor,
} from '../file-editor'

const initial = accessFileEditorOf({ editing: true, modeText: '0600' })
const contents = 'TOKEN=plaintext\n'
const loaded = loadAccessFileEditor({ state: initial, contents })

describe('access file editor', () => {
  it('keeps an existing file editor empty until explicitly loaded', () => {
    expect(initial.loaded).toBe(false)
    expect(initial.contents).toBe('')
    expect(initial.originalContents).toBe('')
    expect(accessFileEditorDirty(initial)).toBe(false)
    expect(loaded.loaded).toBe(true)
    expect(loaded.contents).toBe(contents)
    expect(accessFileEditorDirty(loaded)).toBe(false)
    expect(initial.contents).toBe('')
  })

  it('starts new files with an empty editable draft', () => {
    const created = accessFileEditorOf({ editing: false, modeText: '0644' })
    expect(created.loaded).toBe(true)
    expect(created.contents).toBe('')
    expect(created.modeText).toBe('0644')
    expect(accessFileEditorDirty(created)).toBe(false)
  })

  it('clears both plaintext copies and disables save when a clean editor is hidden', () => {
    expect(clearAccessFileEditor(loaded)).toEqual(initial)
    expect(clearAccessFileEditor(loaded).loaded).toBe(false)
    expect(loaded.contents).toBe(contents)
  })

  it('requires a discard decision for changed contents or mode', () => {
    expect(accessFileEditorDirty({ ...loaded, contents: 'changed' })).toBe(true)
    expect(accessFileEditorDirty({ ...loaded, modeText: '0644' })).toBe(true)
    expect(accessFileEditorDirty({ ...loaded, contents })).toBe(false)
  })

  it('does not overwrite unsaved edits when the file is revealed again', () => {
    const changed = { ...loaded, contents: 'unsaved', modeText: '0644' }
    expect(loadAccessFileEditor({ state: changed, contents: 'server contents' })).toBe(changed)
    expect(changed.contents).toBe('unsaved')
    expect(accessFileEditorDirty(changed)).toBe(true)
  })

  it('discards changed contents and mode only when explicitly cleared', () => {
    const changed = { ...loaded, contents: 'unsaved', modeText: '0644' }
    const cleared = clearAccessFileEditor(changed)
    expect(cleared).toEqual(initial)
    expect(changed.contents).toBe('unsaved')
    expect(changed.modeText).toBe('0644')
    expect(loadAccessFileEditor({ state: cleared, contents: 'fresh' }).contents).toBe('fresh')
  })
})
