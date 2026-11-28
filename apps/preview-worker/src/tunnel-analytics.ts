import type { TunnelAnswer } from './tunnel-wait'

export type PreviewAnalytics = {
  key: string
  waitUntil: (promise: Promise<unknown>) => void
  capture?: (url: string, init: RequestInit) => Promise<Response>
}

export enum ETunnelHoldOutcome {
  Ok = 'ok',
  StartingPage = 'starting_page',
  RawError = 'raw_error',
}

export function trackTunnelHold(args: {
  analytics: PreviewAnalytics | undefined
  answer: TunnelAnswer
  hostname: string
  request: Request
  document: boolean
}): void {
  const { analytics, answer } = args
  if (analytics === undefined || answer.hold === undefined) return
  const outcome = !answer.tunnelError
    ? ETunnelHoldOutcome.Ok
    : args.document
      ? ETunnelHoldOutcome.StartingPage
      : ETunnelHoldOutcome.RawError
  const send = async () => {
    const response = await (analytics.capture ?? fetch)('https://us.i.posthog.com/i/v0/e/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: analytics.key,
        event: 'preview_tunnel_hold',
        distinct_id: `preview:${args.hostname}`,
        properties: {
          preview_hostname: args.hostname,
          tries: answer.hold?.tries,
          hold_ms: answer.hold?.holdMs,
          outcome,
          method: args.request.method,
          document: args.document,
          $process_person_profile: false,
        },
      }),
    })
    await response.body?.cancel()
  }
  analytics.waitUntil(send().catch(() => undefined))
}
