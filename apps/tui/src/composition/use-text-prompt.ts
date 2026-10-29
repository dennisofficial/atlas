import {
  backspaceTextPrompt,
  commitTextPrompt,
  ETextCommit,
  openTextPrompt,
  typeIntoTextPrompt,
  ESettingId,
  type SettingValue,
  type TextDefinition,
  type TextPrompt,
} from '@dltech/atlas-core'
import type { SettingsService, SettingsWrite, VercelCredentialStore } from '@dltech/atlas-harness'
import type { KeyEvent, PasteEvent } from '@opentui/core'
import { usePaste } from '@opentui/react'
import { useCallback, useMemo, useState } from 'react'

import { isPrintable } from '../ui/keys/printable'
import { pastedText } from '../ui/pasted-text'

const VERCEL_FIELDS = new Map<string, 'teamId' | 'projectId'>([
  [ESettingId.VercelTeamId, 'teamId'],
  [ESettingId.VercelProjectId, 'projectId'],
])

const vercelFieldOf = (args: { vercel: VercelCredentialStore; id: string }): string | undefined => {
  const field = VERCEL_FIELDS.get(args.id)
  return field === undefined ? undefined : args.vercel.snapshot()[field]
}

export type TextPromptControl = {
  prompt: TextPrompt | null
  open: (definition: TextDefinition, current: SettingValue) => void
  close: () => void
  handleKey: (key: KeyEvent, current: TextPrompt) => void
}

export function useTextPrompt(args: {
  settings: SettingsService
  settle: (result: SettingsWrite) => void
  vercel: VercelCredentialStore
  onVercelChanged: () => void
}): TextPromptControl {
  const { settings, settle, vercel, onVercelChanged } = args

  const [prompt, setPrompt] = useState<TextPrompt | null>(null)

  const open = useCallback(
    (definition: TextDefinition, current: SettingValue) => {
      const held = vercel.signedIn() ? vercelFieldOf({ vercel, id: definition.id }) : undefined
      const shown = held ?? current
      setPrompt(
        openTextPrompt({
          id: definition.id,
          label: definition.label,
          current: typeof shown === 'string' ? shown : definition.fallback,
        }),
      )
    },
    [vercel],
  )

  const close = useCallback(() => setPrompt(null), [])

  const commit = useCallback(
    (current: TextPrompt) => {
      const committed = commitTextPrompt(current)
      const field = vercel.signedIn() ? VERCEL_FIELDS.get(committed.id) : undefined
      if (field !== undefined) {
        const value = committed.action === ETextCommit.Save ? committed.value : ''
        void vercel.update({ [field]: value }).then((result) => {
          settle(result)
          onVercelChanged()
        })
        setPrompt(null)
        return
      }
      settle(
        committed.action === ETextCommit.Save
          ? settings.set({ id: committed.id, value: committed.value })
          : settings.clear({ id: committed.id }),
      )
      setPrompt(null)
    },
    [onVercelChanged, settings, settle, vercel],
  )

  const handleKey = useCallback(
    (key: KeyEvent, current: TextPrompt) => {
      if (key.name === 'escape') {
        setPrompt(null)
        return
      }

      if (key.name === 'return') {
        commit(current)
        return
      }

      if (key.name === 'backspace') {
        setPrompt((held) => (held === null ? null : backspaceTextPrompt(held)))
        return
      }

      if (isPrintable(key)) {
        const text = key.sequence ?? ''
        setPrompt((held) => (held === null ? null : typeIntoTextPrompt({ prompt: held, text })))
      }
    },
    [commit],
  )

  usePaste(
    useCallback(
      (event: PasteEvent) => {
        if (prompt === null) return

        const pasted = pastedText(event)
        if (pasted.length === 0) return

        event.preventDefault()
        event.stopPropagation()
        setPrompt((held) =>
          held === null ? null : typeIntoTextPrompt({ prompt: held, text: pasted }),
        )
      },
      [prompt],
    ),
  )

  return useMemo(() => ({ prompt, open, close, handleKey }), [close, handleKey, open, prompt])
}
