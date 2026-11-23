import {
  ECommandEntryKind,
  ECommandGroup,
  ECommandSource,
  type CommandEntry,
} from '@dltech/atlas-commands'
import { describe, expect, it } from 'bun:test'

import {
  completedSlashText,
  moveSlashSelection,
  openSlashMenu,
  selectedSlashEntry,
  slashMenuWindow,
} from '../slash-menu'

const entry = (args: { name: string; summary?: string; hint?: string }): CommandEntry => ({
  name: args.name,
  summary: args.summary ?? `${args.name} does something`,
  group: ECommandGroup.Context,
  kind: ECommandEntryKind.Command,
  source: ECommandSource.Builtin,
  ...(args.hint === undefined ? {} : { argumentHint: args.hint }),
})

const ENTRIES: readonly CommandEntry[] = [
  entry({ name: 'rewind', summary: 'rewind the conversation', hint: '<message>' }),
  entry({ name: 'rename', summary: 'name this thread', hint: '<name>' }),
  entry({ name: 'resize', summary: 'change the pod shape' }),
  entry({ name: 'sessions', summary: 'go back to the list' }),
  entry({ name: 'new', summary: 'start a session in this clone' }),
  entry({ name: 'skills', summary: 'reload the skills of this account' }),
]

const namesOf = (rows: readonly CommandEntry[]): readonly string[] => rows.map((row) => row.name)

describe('when the menu opens', () => {
  it('opens on a bare slash and lists everything', () => {
    const state = openSlashMenu({ text: '/', entries: ENTRIES })
    expect(state?.query).toBe('')
    expect(namesOf(state?.rows ?? [])).toEqual(namesOf(ENTRIES))
  })

  it('puts the rows whose name starts with the query before the rows that only mention it', () => {
    const rows = openSlashMenu({ text: '/re', entries: ENTRIES })?.rows ?? []
    expect(namesOf(rows)).toEqual(['rewind', 'rename', 'resize', 'skills'])
  })

  it('matches a summary that holds the query', () => {
    const rows = openSlashMenu({ text: '/pod', entries: ENTRIES })?.rows ?? []
    expect(namesOf(rows)).toEqual(['resize'])
  })

  it('opens on a slash later in the line', () => {
    expect(openSlashMenu({ text: 'please use /re', entries: ENTRIES })?.query).toBe('re')
  })

  it('stays shut once the name is finished and an argument begins', () => {
    expect(openSlashMenu({ text: '/rewind ', entries: ENTRIES })).toBeNull()
    expect(openSlashMenu({ text: '/rewind 3', entries: ENTRIES })).toBeNull()
  })

  it('stays shut when nothing matches', () => {
    expect(openSlashMenu({ text: '/zzz', entries: ENTRIES })).toBeNull()
  })

  it('stays shut on an empty draft', () => {
    expect(openSlashMenu({ text: '', entries: ENTRIES })).toBeNull()
  })
})

describe('moving the selection', () => {
  const opened = openSlashMenu({ text: '/', entries: ENTRIES })

  it('walks down and wraps past the last row', () => {
    if (opened === null) throw new Error('the menu did not open')
    const last = moveSlashSelection({
      state: { ...opened, index: opened.rows.length - 1 },
      delta: 1,
    })
    expect(last.index).toBe(0)
  })

  it('walks up and wraps past the first row', () => {
    if (opened === null) throw new Error('the menu did not open')
    expect(moveSlashSelection({ state: opened, delta: -1 }).index).toBe(opened.rows.length - 1)
  })

  it('names the row under the caret', () => {
    if (opened === null) throw new Error('the menu did not open')
    expect(selectedSlashEntry(opened)?.name).toBe('rewind')
  })
})

describe('completing a row into the draft', () => {
  it('rewrites the slash word and leaves a space for the argument', () => {
    const rewind = ENTRIES[0]
    if (rewind === undefined) throw new Error('no rewind row')
    expect(completedSlashText({ text: '/re', entry: rewind })).toBe('/rewind ')
  })

  it('keeps whatever the operator typed before the slash and after the line', () => {
    const rewind = ENTRIES[0]
    if (rewind === undefined) throw new Error('no rewind row')
    expect(completedSlashText({ text: 'please /re\nand then more', entry: rewind })).toBe(
      'please /rewind \nand then more',
    )
  })
})

describe('the window of rows on screen', () => {
  it('shows a slice that keeps the selection in view', () => {
    const many = Array.from({ length: 12 }, (_unused, index) => entry({ name: `row-${index}` }))
    const state = { query: '', index: 11, rows: many }
    const window = slashMenuWindow({ state, rows: 5 })
    expect(window.start).toBe(7)
    expect(window.visible).toHaveLength(5)
    expect(window.visible.at(-1)?.name).toBe('row-11')
  })
})
