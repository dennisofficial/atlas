export type SsePullRequestClock = {
  now?: () => number
  setTimeoutFn?: typeof setTimeout
  clearTimeoutFn?: typeof clearTimeout
  randomFn?: () => number
}

export const resolveSseClock = (clock: SsePullRequestClock | undefined): Required<SsePullRequestClock> => ({
  now: clock?.now ?? Date.now,
  setTimeoutFn: clock?.setTimeoutFn ?? setTimeout,
  clearTimeoutFn: clock?.clearTimeoutFn ?? clearTimeout,
  randomFn: clock?.randomFn ?? Math.random,
})
