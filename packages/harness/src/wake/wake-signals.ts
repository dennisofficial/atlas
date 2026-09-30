import { DEFAULT_JUMP_THRESHOLD_MS, type ClockJump } from './clock-jump-detector'

export { DEFAULT_JUMP_THRESHOLD_MS }

export interface WakeSignal {
  subscribe(listener: (jump: ClockJump) => void): () => void
  wasWakeRecent(withinMs: number): boolean
}
