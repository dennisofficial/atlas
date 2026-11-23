import type { PasteEvent } from '@opentui/core'
import { usePaste } from '@opentui/react'
import { useCallback } from 'react'

import { tokenizablePaste } from '../composer-tokens'
import type { useDraftTokens } from './use-draft-tokens'
import { isEmptyPaste, pastedContent } from '../pasted-text'

export function useComposerPaste(args: {
  overlaid: boolean
  tokens: ReturnType<typeof useDraftTokens>
  handleAttachImage: () => boolean
}) {
  const { overlaid, tokens, handleAttachImage } = args

  usePaste(
    useCallback(
      (event: PasteEvent) => {
        if (overlaid) return

        const content = pastedContent(event)
        if (isEmptyPaste(event)) {
          event.preventDefault()
          event.stopPropagation()
          handleAttachImage()
          return
        }

        if (tokenizablePaste(content)) {
          event.preventDefault()
          event.stopPropagation()
          tokens.handlePasted(content)
          return
        }
      },
      [handleAttachImage, overlaid, tokens],
    ),
  )
}
