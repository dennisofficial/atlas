'use client'

import { useEffect, useState } from 'react'

import { nativeOf } from './native-controls'
import { nativeStatsOf } from './native-stats'
import { isNativeWebview } from './webview-handle'

export type DiagnosticsReport = {
  webviewId: number | undefined
  hidden: boolean | undefined
  width: number
  height: number
  left: number
  top: number
  navigations: number
  ready: number
  lastUrl: string | undefined
}

export function diagnosticsOf(args: {
  element: Element | null
  stats: ReturnType<typeof nativeStatsOf>
}): DiagnosticsReport {
  const { element, stats } = args
  const rect = element?.getBoundingClientRect()
  const webview = isNativeWebview(element) ? element : undefined
  return {
    webviewId: webview?.webviewId ?? undefined,
    hidden: webview?.hidden,
    width: Math.round(rect?.width ?? 0),
    height: Math.round(rect?.height ?? 0),
    left: Math.round(rect?.left ?? 0),
    top: Math.round(rect?.top ?? 0),
    navigations: stats.navigations,
    ready: stats.ready,
    lastUrl: stats.lastUrl,
  }
}

export const describeDiagnostics = (report: DiagnosticsReport): string =>
  [
    `cef ${report.webviewId === undefined ? 'no-view' : `#${report.webviewId}`}`,
    report.hidden === undefined ? 'hidden ?' : report.hidden ? 'hidden' : 'shown',
    `${report.width}x${report.height} @ ${report.left},${report.top}`,
    `nav ${report.navigations}`,
    `ready ${report.ready}`,
    report.lastUrl ?? 'no-url',
  ].join(' · ')

export function NativeDiagnostics({ frameKey }: { frameKey: string | undefined }) {
  const [report, setReport] = useState<DiagnosticsReport | undefined>(undefined)

  useEffect(() => {
    if (frameKey === undefined) return undefined
    const tick = () =>
      setReport(
        diagnosticsOf({
          element: nativeOf(frameKey)?.webview ?? null,
          stats: nativeStatsOf(frameKey),
        }),
      )
    tick()
    const handle = setInterval(tick, 750)
    return () => clearInterval(handle)
  }, [frameKey])

  if (report === undefined) return null
  if (report.ready > 0 || report.navigations > 0) return null
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed bottom-1 left-1 z-50 max-w-[calc(100%-0.5rem)] truncate rounded bg-background/85 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
    >
      {describeDiagnostics(report)}
    </div>
  )
}
