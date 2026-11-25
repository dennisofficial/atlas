import type { KeyEvent } from '@opentui/core'
import type { CommandEntry, EClientAction } from '@dltech/atlas-commands'
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

import type { DraftControls } from '../ui/hooks/use-draft'
import { messageOf } from './app-next-support'
import { commandEntriesOf, panelActionOf, TUI_OWNED_NAMES } from './command-entries'
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

const takesArgument = (entry: CommandEntry): boolean => entry.argumentHint?.startsWith('<') === true

export function useCommandMenu(args: {
  api: SessionApi
  draft: Pick<DraftControls, 'setValue' | 'clear'> & {
    editor: RefObject<{ plainText: string } | null>
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

  const { api, onAction, onLocal, onRun } = args

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
    (args: { entry: CommandEntry; completes: boolean }) => {
      const name = args.entry.name
      if (args.completes) {
        complete(args.entry)
        return
      }

      if (TUI_OWNED_NAMES.includes(name)) {
        clear()
        onLocal(name)
        return
      }

      const action = args.entry.opens ?? panelActionOf(name)
      if (action !== null) {
        clear()
        onAction(action)
        return
      }

      if (takesArgument(args.entry)) {
        complete(args.entry)
        return
      }

      clear()
      onRun(`/${name}`)
    },
    [clear, complete, onAction, onLocal, onRun],
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

  const syncedToDraft = useCallback((): SlashMenuState | null => {
    const text = textNow()
    if (text !== typed.current) handleText(text)
    return held.current
  }, [handleText, textNow])

  const handleOpen = useCallback(() => {
    const rows = known.current
    if (rows.length === 0) return
    put({ query: '', index: 0, rows })
  }, [put])

  const handleKey = useCallback(
    (key: KeyEvent): boolean => {
      const current = syncedToDraft()
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
        if (entry !== null) runEntry({ entry, completes: true })
        return true
      }

      if (key.name === 'return' || key.name === 'enter') {
        key.preventDefault()
        const entry = selectedSlashEntry(current)
        if (entry === null) {
          put(null)
          return true
        }
        runEntry({ entry, completes: false })
        return true
      }

      return false
    },
    [put, runEntry, syncedToDraft],
  )

  const handleSubmit = useCallback(
    (text: string): boolean => {
      const line = text.trim()
      if (!line.startsWith('/') || line.includes(' ')) return false
      const entry = known.current.find((candidate) => candidate.name === line.slice(1))
      if (entry === undefined) return false
      const action = entry.opens ?? panelActionOf(entry.name)
      if (!TUI_OWNED_NAMES.includes(entry.name) && action === null) return false
      put(null)
      runEntry({ entry, completes: false })
      return true
    },
    [put, runEntry],
  )

  const handleSelectRow = useCallback(
    (index: number) => {
      const current = held.current
      const entry = current?.rows[index]
      if (entry === undefined) return
      runEntry({ entry, completes: false })
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
