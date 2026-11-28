'use client'

import { useCallback, useEffect, useRef } from 'react'

import type { EPodPowerPhase } from '@dltech/atlas-core'

import { useHasNativeBrowser } from '@/features/desktop/use-has-native-browser'
import { currentUrlOf } from '@/features/threads/data/preview-browser/browser-model'
import {
  previewNeedsWake,
  type EPreviewWait,
} from '@/features/threads/data/preview-browser/preview-wake'
import { usePreviewBrowser } from '@/features/threads/data/preview-browser/use-preview-browser'
import { useFrameRegistry } from '@/features/threads/panel/preview/frame-registry'
import {
  subscribePreviewDocuments,
  type PreviewDocumentReport,
} from '@/features/threads/panel/preview/preview-document-reports'
import { track, trackBeforeUnload } from '@/lib/analytics/analytics'

import {
  EPreviewWakeOutcome,
  previewWakeAttemptOf,
  previewWakeProperties,
  previewWakeReport,
  type PreviewWakeAttempt,
} from './preview-wake-attempt'

type HeldAttempt = {
  attempt: PreviewWakeAttempt
  tabId?: string
  paneSeen: boolean
  report?: PreviewDocumentReport
}

const emit = (args: { held: HeldAttempt; outcome: EPreviewWakeOutcome }) => {
  const properties = previewWakeProperties({
    attempt: args.held.attempt,
    outcome: args.outcome,
    now: performance.now(),
  })
  if (args.outcome === EPreviewWakeOutcome.Abandoned)
    trackBeforeUnload('preview_wake_open', properties)
  else track('preview_wake_open', properties)
}

export function usePreviewWakeTracking(args: {
  sessionId: string
  power: EPodPowerPhase | undefined
  wait: EPreviewWait
}): (url: string) => void {
  const { sessionId, power, wait } = args
  const native = useHasNativeBrowser()
  const attempts = useRef(new Map<string, HeldAttempt>())
  const { state } = usePreviewBrowser(sessionId)
  const registry = useFrameRegistry()
  const visible = useRef(registry.visible)
  visible.current = registry.visible

  useEffect(() => {
    const held = attempts.current
    const handleAbandon = () => {
      for (const attempt of held.values())
        emit({ held: attempt, outcome: EPreviewWakeOutcome.Abandoned })
      held.clear()
    }
    const unsubscribe = subscribePreviewDocuments((report) => {
      if (report.sessionId !== sessionId || !URL.canParse(report.url)) return
      const hostname = new URL(report.url).hostname
      const one = held.get(hostname)
      if (one === undefined || (one.tabId !== undefined && one.tabId !== report.tabId)) return
      one.report = report
      const result = previewWakeReport({
        attempt: one.attempt,
        ...report,
        visible: visible.current?.threadId === sessionId && visible.current.tabId === report.tabId,
      })
      one.attempt = result.attempt
      if (result.outcome === undefined) return
      held.delete(hostname)
      emit({ held: one, outcome: result.outcome })
    })
    window.addEventListener('pagehide', handleAbandon)
    window.addEventListener('beforeunload', handleAbandon)
    return () => {
      unsubscribe()
      window.removeEventListener('pagehide', handleAbandon)
      window.removeEventListener('beforeunload', handleAbandon)
      handleAbandon()
    }
  }, [sessionId])

  useEffect(() => {
    for (const [hostname, held] of attempts.current) {
      const tab =
        held.tabId === undefined
          ? state.tabs.find((tab) => {
              const url = currentUrlOf(tab)
              return URL.canParse(url) && new URL(url).hostname === hostname
            })
          : state.tabs.find((tab) => tab.id === held.tabId)
      const tabClosed = held.tabId !== undefined && tab === undefined
      const paneClosed = held.paneSeen && registry.visible === undefined
      if (tabClosed || paneClosed) {
        attempts.current.delete(hostname)
        emit({ held, outcome: EPreviewWakeOutcome.Abandoned })
        continue
      }
      if (tab !== undefined) held.tabId = tab.id
      const visible =
        registry.visible?.threadId === sessionId && registry.visible.tabId === held.tabId
      if (visible) held.paneSeen = true
      if (held.report === undefined) continue
      const result = previewWakeReport({ attempt: held.attempt, ...held.report, visible })
      held.attempt = result.attempt
      if (result.outcome === undefined) continue
      attempts.current.delete(hostname)
      emit({ held, outcome: result.outcome })
    }
  }, [state, registry.visible, sessionId])

  return useCallback(
    (url: string) => {
      if (native) return
      const attempt = previewWakeAttemptOf({
        sessionId,
        url,
        phase: power,
        wait,
        wakeRequested: previewNeedsWake(wait),
        now: performance.now(),
      })
      if (attempt === undefined) return
      const previous = attempts.current.get(attempt.hostname)
      if (previous !== undefined) emit({ held: previous, outcome: EPreviewWakeOutcome.Abandoned })
      attempts.current.set(attempt.hostname, { attempt, paneSeen: false })
    },
    [sessionId, power, wait, native],
  )
}
