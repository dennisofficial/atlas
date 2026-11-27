import type { PreviewPort } from '@dltech/atlas-ui/ai/preview-browser'

import {
  activeTabOf,
  currentUrlOf,
  NEW_TAB_URL,
} from '@/features/threads/data/preview-browser/browser-model'
import { openUrlIn } from '@/features/threads/data/preview-browser/open-in-browser'
import { previewCallbackUrlOf } from '@/features/threads/data/preview-browser/preview-callback'
import { revealedPreview } from '@/features/threads/data/preview-browser/preview-wake'
import { updatePreviewBrowser } from '@/features/threads/data/preview-browser/use-preview-browser'

export function openBrowserUrl(args: {
  sessionId: string
  url: string
  ports: readonly PreviewPort[]
}): void {
  const { sessionId, url, ports } = args
  updatePreviewBrowser({
    threadId: sessionId,
    change: ({ state }) => {
      const revealed = revealedPreview({ state, url, ports })
      if (revealed !== null) return revealed
      const active = activeTabOf(state)
      const currentUrl = active === undefined ? NEW_TAB_URL : currentUrlOf(active)
      const callback = previewCallbackUrlOf({ url, currentUrl, ports: [...ports] })
      return openUrlIn({ state, url: callback ?? url })
    },
  })
}
