import type { ClockJumpDetector } from '../loop/retrying-step'
import type { WakeSignal } from '../wake/wake-signals'

export const asClockJumps = (wake: WakeSignal): ClockJumpDetector => ({
  onJump: (callback) => wake.subscribe((jump) => callback(jump.gapMs)),
})
