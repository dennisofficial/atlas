import { useCallback, useEffect, useRef } from 'react'

import { updatePreviewBrowser } from '../../data/preview-browser/use-preview-browser'
import { frameReportOf } from './frame-messages'
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
      updatePreviewBrowser({
        threadId: target.threadId,
        change: ({ state }) =>
          reportedState({ state, tabId: target.tabId, url: report.url, title: report.title }),
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
