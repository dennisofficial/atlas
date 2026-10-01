import type { PasteEvent } from '@opentui/core'
import { usePaste } from '@opentui/react'
import { useCallback } from 'react'

import { tokenizablePaste } from '../ui/composer-tokens'
import type { useDraftTokens } from '../ui/hooks/use-draft-tokens'
import { isEmptyPaste, pastedContent } from '../ui/pasted-text'

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
