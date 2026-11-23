import {
  backspaceSecretPrompt,
  commitSecretPrompt,
  ESecretCommit,
  openSecretPrompt,
  typeIntoSecretPrompt,
  type SecretPrompt,
  type SettingsResolution,
} from '@dltech/atlas-core'
import type { KeyEvent, PasteEvent } from '@opentui/core'
import { usePaste } from '@opentui/react'
import { useCallback, useMemo, useState } from 'react'

import type { Span } from '../ui/components/spans'
import { isPrintable } from '../ui/keys/printable'
import { pastedText } from '../ui/pasted-text'
import { secretTargetOf } from '../ui/secret-target'
import { secretDisplay } from '../ui/settings-format'
import { SECRET_SET, type SecretControl } from './use-secrets'

export type SecretPromptControl = {
  prompt: SecretPrompt | null
  origin: string
  displayOf: (id: string) => Span | undefined
  open: (id: string) => boolean
  close: () => void
  refresh: () => void
  handleKey: (key: KeyEvent, current: SecretPrompt) => void
}

const SECRET_ORIGIN = 'your account'

export function useSecretPrompt(args: {
  secrets: SecretControl
  resolution: SettingsResolution
}): SecretPromptControl {
  const { secrets, resolution } = args
  const [prompt, setPrompt] = useState<SecretPrompt | null>(null)
  const [reads, setReads] = useState(0)

  const displayOf = useCallback(
    (id: string): Span | undefined => {
      void reads
      const target = secretTargetOf({ id, resolution })
      if (target === undefined) return undefined

      return secretDisplay({
        held: target.takesOne && secrets.present(target.name) ? SECRET_SET : undefined,
        masked: target.masked,
        required: target.required,
        takesOne: target.takesOne,
      })
    },
    [reads, resolution, secrets],
  )

  const open = useCallback(
    (id: string): boolean => {
      const target = secretTargetOf({ id, resolution })
      if (target === undefined || !target.takesOne) return false

      setPrompt(openSecretPrompt({ name: target.name, label: target.label, masked: target.masked }))
      return true
    },
    [resolution],
  )

  const close = useCallback(() => setPrompt(null), [])

  const refresh = useCallback(() => {
    setReads((read) => read + 1)
    secrets.refresh()
  }, [secrets])

  const commit = useCallback(
    (current: SecretPrompt) => {
      const committed = commitSecretPrompt(current)
      setPrompt(null)
      if (committed.action === ESecretCommit.Save)
        void secrets.save({ name: committed.name, value: committed.value })
      else void secrets.clear(committed.name)
    },
    [secrets],
  )

  const handleKey = useCallback(
    (key: KeyEvent, current: SecretPrompt) => {
      if (key.name === 'escape') {
        setPrompt(null)
        return
      }

      if (key.name === 'return') {
        commit(current)
        return
      }

      if (key.name === 'backspace') {
        setPrompt(backspaceSecretPrompt(current))
        return
      }

      if (isPrintable(key)) {
        setPrompt(typeIntoSecretPrompt({ prompt: current, text: key.sequence ?? '' }))
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
        setPrompt(typeIntoSecretPrompt({ prompt, text: pasted }))
      },
      [prompt],
    ),
  )

  return useMemo(
    () => ({ prompt, origin: SECRET_ORIGIN, displayOf, open, close, refresh, handleKey }),
    [close, displayOf, handleKey, open, prompt, refresh],
  )
}
