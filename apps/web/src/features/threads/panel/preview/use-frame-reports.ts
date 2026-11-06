import { useCallback, useEffect, useRef } from 'react'

import { updatePreviewBrowser } from '../../data/preview-browser/use-preview-browser'
import { EFrameMessage, frameReportOf } from './frame-messages'
import { changeRegistry, withLoading } from './frame-registry'
import type { FrameSpec } from './frames-of'
import { reportedState } from './report-navigation'

type HeldFrame = { iframe: HTMLIFrameElement; threadId: string; tabId: string }

export function useFrameReports(): (frame: FrameSpec) => (iframe: HTMLIFrameElement) => () => void {
  const held = useRef(new Map<string, HeldFrame>())
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const windows = new Map([...held.current].map(([key, at]) => [key, at.iframe.contentWindow]))
      const report = frameReportOf({
        origin: event.origin,
        source: event.source,
        data: event.data,
        windows,
      })
      const target = report === null ? undefined : held.current.get(report.key)
      if (report === null || target === undefined) return
      const { message } = report
      if (message.kind === EFrameMessage.Loading) {
        changeRegistry((registry) => withLoading({ registry, key: report.key, loading: true }))
        return
      }
      updatePreviewBrowser({
        threadId: target.threadId,
        change: ({ state }) =>
          reportedState({ state, tabId: target.tabId, url: message.url, title: message.title }),
      })
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])
  return useCallback(
    (frame) => (iframe) => {
      const entry = { iframe, threadId: frame.threadId, tabId: frame.tabId }
      held.current.set(frame.key, entry)
      return () => {
        if (held.current.get(frame.key) === entry) held.current.delete(frame.key)
      }
    },
    [],
  )
}
