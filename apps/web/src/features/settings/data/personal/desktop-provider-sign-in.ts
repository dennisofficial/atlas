import { z } from 'zod'

import type { EOauthProvider } from '@dltech/atlas-wire/web'

export enum EDesktopProviderResult {
  Fallback = 'fallback',
  SignedIn = 'signed-in',
  Cancelled = 'cancelled',
}

enum EDesktopProviderState {
  Pending = 'pending',
  SignedIn = 'signed-in',
  Failed = 'failed',
  Cancelled = 'cancelled',
}

const PREFIX = '/desktop/provider-sign-in'
const POLL_MS = 2000
const startSchema = z.object({ attemptId: z.string().min(1) })
const statusSchema = z.object({
  state: z.enum(EDesktopProviderState),
  reason: z.string().optional(),
})

const wait = (signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const handleAbort = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', handleAbort)
      resolve()
    }
    const timer = setTimeout(handleAbort, POLL_MS)
    signal.addEventListener('abort', handleAbort, { once: true })
    if (signal.aborted) handleAbort()
  })

export async function signInThroughDesktop(args: {
  provider: EOauthProvider
  signal: AbortSignal
  onWaiting: () => void
}): Promise<EDesktopProviderResult> {
  const { signal } = args
  const response = await fetch(`${PREFIX}/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: args.provider }),
  })
  if ([404, 409, 502].includes(response.status)) return EDesktopProviderResult.Fallback
  if (!response.ok) throw new Error('Could not start sign-in on this Mac')
  const { attemptId } = startSchema.parse(await response.json())
  let stopped = false
  let finished = false
  const handleStop = (): void => {
    if (stopped || finished) return
    stopped = true
    void fetch(`${PREFIX}/stop`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ attemptId }),
    }).catch(() => undefined)
  }
  signal.addEventListener('abort', handleStop, { once: true })
  try {
    if (signal.aborted) return EDesktopProviderResult.Cancelled
    args.onWaiting()
    while (!signal.aborted) {
      const status = await fetch(`${PREFIX}/status?attempt=${encodeURIComponent(attemptId)}`, {
        signal,
        cache: 'no-store',
      })
      if (signal.aborted) return EDesktopProviderResult.Cancelled
      if (!status.ok) throw new Error('Could not read sign-in status from this Mac')
      const result = statusSchema.parse(await status.json())
      if (signal.aborted) return EDesktopProviderResult.Cancelled
      if (result.state !== EDesktopProviderState.Pending) finished = true
      if (result.state === EDesktopProviderState.SignedIn) return EDesktopProviderResult.SignedIn
      if (result.state === EDesktopProviderState.Cancelled) return EDesktopProviderResult.Cancelled
      if (result.state === EDesktopProviderState.Failed)
        throw new Error(result.reason ?? 'Provider sign-in failed')
      await wait(signal)
    }
    return EDesktopProviderResult.Cancelled
  } catch (error) {
    if (signal.aborted) return EDesktopProviderResult.Cancelled
    throw error
  } finally {
    signal.removeEventListener('abort', handleStop)
    handleStop()
  }
}
