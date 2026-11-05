import type { HostTimers } from '@dltech/atlas-host'

export const systemHostTimers: HostTimers = {
  now: () => Date.now(),
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: (timer) => clearTimeout(timer as Parameters<typeof clearTimeout>[0]),
  random: () => Math.random(),
}
