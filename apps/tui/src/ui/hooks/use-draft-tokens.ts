import { useCallback, useRef, type RefObject } from 'react'

import type { TextareaRenderable } from '@opentui/core'

import type { ClipboardImageReader } from '../clipboard-image'
import {
  insertImagePlaceholder,
  insertPastedToken,
  liveTokens,
  removeToken,
  type LiveToken,
} from '../composer-tokens'
import { restoredDraft, type RestoredPasteContent } from '../composer-restore'
import type { EImageTier } from '@dltech/atlas-core'
import type { DraftImage } from '../draft-images'

export type DraftTokens = {
  tokens: () => LiveToken[]
  handleImage: () => void
  handlePasted: (content: string) => void
  settle: () => Promise<void>
  restore: (args: {
    text: string
    images: readonly DraftImage[]
    pastes?: readonly RestoredPasteContent[]
  }) => void
}

/**
 * Token bookkeeping against the editor's extmarks. The label lands synchronously so a paste paints
 * at once, while the clipboard read resolves in and either fills the slot or cuts the span back
 * out. Submitting awaits `settle` rather than racing whatever read is still in flight.
 */
export function useDraftTokens(args: {
  editor: RefObject<TextareaRenderable | null>
  read: ClipboardImageReader
  directory: string
  tier?: EImageTier | undefined
}): DraftTokens {
  const pending = useRef<Promise<void>[]>([])

  const tokens = useCallback((): LiveToken[] => {
    const editor = args.editor.current
    return editor === null ? [] : liveTokens(editor)
  }, [args.editor])

  const handleImage = useCallback((): void => {
    const editor = args.editor.current
    if (editor === null) return

    const token = insertImagePlaceholder(editor)

    const reading = args.read({ directory: args.directory, tier: args.tier }).then((image) => {
      if (token.slot.kind !== 'image') return
      if (image === null) {
        const current = editor.extmarks.get(token.id)
        if (current !== null) {
          removeToken(editor, { ...token, start: current.start, end: current.end })
        }
        return
      }
      if (editor.extmarks.get(token.id) === null) return
      token.slot.settled = true
      token.slot.image = image
    })

    pending.current = [...pending.current, reading]
  }, [args.directory, args.editor, args.read, args.tier])

  const handlePasted = useCallback(
    (content: string): void => {
      const editor = args.editor.current
      if (editor === null) return
      insertPastedToken({ editor, content })
    },
    [args.editor],
  )

  const settle = useCallback(async (): Promise<void> => {
    await Promise.allSettled(pending.current)
    pending.current = []
  }, [])

  const restore = useCallback(
    (restored: {
      text: string
      images: readonly DraftImage[]
      pastes?: readonly RestoredPasteContent[]
    }): void => {
      const editor = args.editor.current
      if (editor === null) return
      restoredDraft({
        editor,
        text: restored.text,
        images: restored.images,
        pastes: restored.pastes,
      })
    },
    [args.editor],
  )

  return { tokens, handleImage, handlePasted, settle, restore }
}
