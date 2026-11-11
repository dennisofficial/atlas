'use client'

import { useEffect } from 'react'

import { updatePreviewBrowser } from '../../../data/preview-browser/use-preview-browser'
import { reportedLocation, reportedTitle } from '../report-navigation'
import { watchPaneNavigations, watchPaneTitles } from './pane-bridge'
import { notePaneLocation } from './pane-locations'
import { paneTargetOf } from './pane-target'

export function PaneReports() {
  useEffect(() => {
    const stopNavigations = watchPaneNavigations({
      host: window,
      onReport: (report) => {
        const target = paneTargetOf(report.id)
        if (target === null) return
        notePaneLocation({ id: report.id, url: report.url })
        updatePreviewBrowser({
          threadId: target.threadId,
          change: ({ state }) => reportedLocation({ state, tabId: target.tabId, url: report.url }),
        })
      },
    })
    const stopTitles = watchPaneTitles({
      host: window,
      onReport: (report) => {
        const target = paneTargetOf(report.id)
        if (target === null) return
        updatePreviewBrowser({
          threadId: target.threadId,
          change: ({ state }) => reportedTitle({ state, tabId: target.tabId, title: report.title }),
        })
      },
    })
    return () => {
      stopNavigations()
      stopTitles()
    }
  }, [])
  return null
}
