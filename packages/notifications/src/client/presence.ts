import { PRESENCE_REPORT_MS } from '@dltech/atlas-core'

export type PresenceState = {
  sessionId: string | null
  foreground: boolean
}

export type PresenceClock<Handle> = {
  setInterval: (handler: () => void, ms: number) => Handle
  clearInterval: (handle: Handle) => void
}

export type PresenceLoop<Handle> = {
  read: () => PresenceState
  report: (state: PresenceState) => void
  subscribe: (onChange: () => void) => () => void
  clock: PresenceClock<Handle>
  every?: number
}

const sameState = (left: PresenceState, right: PresenceState): boolean =>
  left.sessionId === right.sessionId && left.foreground === right.foreground

export const startPresenceReports = <Handle>(args: PresenceLoop<Handle>): (() => void) => {
  const every = args.every ?? PRESENCE_REPORT_MS
  let timer: Handle | undefined
  let last: PresenceState | undefined

  const stopTimer = (): void => {
    if (timer === undefined) return
    args.clock.clearInterval(timer)
    timer = undefined
  }

  const repeat = (): void => {
    const state = args.read()
    if (!state.foreground) return
    last = state
    args.report(state)
  }

  const apply = (): void => {
    const state = args.read()
    if (last !== undefined && sameState(last, state)) return
    last = state
    stopTimer()
    args.report(state)
    if (state.foreground) timer = args.clock.setInterval(repeat, every)
  }

  const unsubscribe = args.subscribe(apply)
  apply()

  return () => {
    unsubscribe()
    stopTimer()
  }
}
