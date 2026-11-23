import type { KeyEvent } from '@opentui/core'
import type { CommandEntry, EClientAction } from '@dltech/atlas-commands'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { DraftControls } from '../ui/hooks/use-draft'
import { messageOf } from './app-next-support'
import { commandEntriesOf, TUI_OWNED_NAMES } from './command-entries'
import type { SessionApi } from './session-api'
import {
  completedSlashText,
  moveSlashSelection,
  openSlashMenu,
  selectedSlashEntry,
  type SlashMenuState,
} from './slash-menu'

export type CommandMenu = {
  state: SlashMenuState | null
  disabled: boolean
  entries: readonly CommandEntry[]
  handleText: (text: string) => void
  handleOpen: () => void
  handleKey: (key: KeyEvent) => boolean
  handleSelectRow: (index: number) => void
  handleSubmit: (text: string) => boolean
}

export function useCommandMenu(args: {
  api: SessionApi
  draft: Pick<DraftControls, 'value' | 'setValue' | 'clear'> & {
    editor: DraftControls['editor']
  }
  onAction: (action: EClientAction) => void
  onLocal: (name: string) => void
  onRun: (text: string) => void
  onProblem: (reason: string) => void
}): CommandMenu {
  const [entries, setEntries] = useState<readonly CommandEntry[]>([])
  const [failed, setFailed] = useState(false)
  const [state, setState] = useState<SlashMenuState | null>(null)

  const held = useRef<SlashMenuState | null>(null)
  const known = useRef<readonly CommandEntry[]>([])
  const typed = useRef('')
  const report = useRef(args.onProblem)
  report.current = args.onProblem

  const put = useCallback((next: SlashMenuState | null) => {
    held.current = next
    setState(next)
  }, [])

  const { api } = args

  useEffect(() => {
    let open = true
    void Promise.all([api.commands(), api.skills()])
      .then(([commands, skills]) => {
        if (!open) return
        const merged = commandEntriesOf({ commands, skills })
        known.current = merged
        setEntries(merged)
        setFailed(false)
      })
      .catch((failure: unknown) => {
        if (!open) return
        setFailed(true)
        report.current(`could not load the commands — ${messageOf(failure)}`)
      })

    return () => {
      open = false
    }
  }, [api])

  const textNow = useCallback(
    (): string => args.draft.editor.current?.plainText ?? typed.current,
    [args.draft.editor],
  )

  const complete = useCallback(
    (entry: CommandEntry) => {
      const text = completedSlashText({ text: textNow(), entry })
      typed.current = text
      args.draft.setValue(text)
      put(openSlashMenu({ text, entries: known.current }))
    },
    [args.draft, put, textNow],
  )

  const clear = useCallback(() => {
    typed.current = ''
    args.draft.clear()
    put(null)
  }, [args.draft, put])

  const runEntry = useCallback(
    (entry: CommandEntry) => {
      if (TUI_OWNED_NAMES.includes(entry.name)) {
        clear()
        args.onLocal(entry.name)
        return
      }

      if (entry.opens !== undefined) {
        clear()
        args.onAction(entry.opens)
        return
      }

      if (entry.argumentHint !== undefined) {
        complete(entry)
        return
      }

      clear()
      args.onRun(`/${entry.name}`)
    },
    [args, clear, complete],
  )

  const handleText = useCallback(
    (text: string) => {
      typed.current = text
      const next = openSlashMenu({ text, entries: known.current })
      const current = held.current
      if (next === null) {
        put(null)
        return
      }
      if (current !== null && current.query === next.query) {
        const index = Math.min(current.index, next.rows.length - 1)
        put({ ...next, index })
        return
      }
      put(next)
    },
    [put],
  )

  const handleOpen = useCallback(() => {
    const rows = known.current
    if (rows.length === 0) return
    put({ query: '', index: 0, rows })
  }, [put])

  const handleKey = useCallback(
    (key: KeyEvent): boolean => {
      const current = held.current
      if (current === null) return false

      if (key.name === 'escape') {
        key.preventDefault()
        put(null)
        return true
      }

      if (key.name === 'up' || key.name === 'down') {
        key.preventDefault()
        put(moveSlashSelection({ state: current, delta: key.name === 'up' ? -1 : 1 }))
        return true
      }

      if (key.name === 'tab') {
        key.preventDefault()
        const entry = selectedSlashEntry(current)
        if (entry !== null) complete(entry)
        return true
      }

      if (key.name === 'return' || key.name === 'enter') {
        key.preventDefault()
        const entry = selectedSlashEntry(current)
        if (entry === null) {
          put(null)
          return true
        }
        runEntry(entry)
        return true
      }

      return false
    },
    [complete, put, runEntry],
  )

  const handleSubmit = useCallback(
    (text: string): boolean => {
      const line = text.trim()
      if (!line.startsWith('/') || line.includes(' ')) return false
      const entry = known.current.find((candidate) => candidate.name === line.slice(1))
      if (entry === undefined) return false
      if (!TUI_OWNED_NAMES.includes(entry.name) && entry.opens === undefined) return false
      put(null)
      runEntry(entry)
      return true
    },
    [put, runEntry],
  )

  const handleSelectRow = useCallback(
    (index: number) => {
      const current = held.current
      const entry = current?.rows[index]
      if (entry === undefined) return
      runEntry(entry)
    },
    [runEntry],
  )

  return {
    state,
    disabled: failed,
    entries,
    handleText,
    handleOpen,
    handleKey,
    handleSelectRow,
    handleSubmit,
  }
}
