export interface NavigationTimingLike {
  startTime: number
  responseStart: number
  domContentLoadedEventEnd: number
  loadEventEnd: number
}

export interface NavigationMetrics {
  ttfb_ms: number
  dom_content_loaded_ms: number
  load_ms: number
}

export function elapsedMs({ from, to }: { from: number; to: number }): number {
  return Math.max(0, Math.round(to - from))
}

export function navigationMetrics(timing: NavigationTimingLike): NavigationMetrics {
  return {
    ttfb_ms: elapsedMs({ from: timing.startTime, to: timing.responseStart }),
    dom_content_loaded_ms: elapsedMs({
      from: timing.startTime,
      to: timing.domContentLoadedEventEnd,
    }),
    load_ms: elapsedMs({ from: timing.startTime, to: timing.loadEventEnd }),
  }
}

export function sessionOpenedProps(args: {
  sessionId: string
  routeAt: number
  firstContentAt: number
}): { session_id: string; v2: true; ms_to_first_content: number } {
  return {
    session_id: args.sessionId,
    v2: true,
    ms_to_first_content: elapsedMs({ from: args.routeAt, to: args.firstContentAt }),
  }
}

export function sidebarSnapshotProps(args: { rows: number; mountedAt: number; now: number }): {
  rows: number
  ms_since_mount: number
} {
  return {
    rows: args.rows,
    ms_since_mount: elapsedMs({ from: args.mountedAt, to: args.now }),
  }
}
