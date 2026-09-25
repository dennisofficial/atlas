import { EFactorySurface } from '../factory.types'

/**
 * The status-signal contract a human reads off a surface: heard → reply-coming → cleared. The
 * states are surface-agnostic; each intake surface ships an adapter that maps them onto its own
 * idiom (GitHub reactions, Linear reactions). The model never touches these — they are the
 * machine being honest about where it is, not speech.
 */
export enum EStatusSignal {
  Heard = 'heard',
  ReplyComing = 'reply-coming',
}

export type StatusSignalRef = {
  surface: EFactorySurface
  /** The work item's organization — credential-scoped adapters (Linear) resolve tokens from it. */
  organizationId: string
  /** The surface-specific locator of the comment the signal rides on. */
  externalId: string
  /** The surface comment the human wrote, in the surface's own id space. */
  commentId: string
}

/**
 * One adapter per intake surface. `set` puts a signal up; `clear` removes every signal the
 * adapter put on the comment (a reply landing clears both heard and reply-coming). Adapters are
 * best-effort: a signal that cannot be set or cleared must not fail the work that triggered it.
 */
export interface StatusSignalAdapter {
  set(args: { ref: StatusSignalRef; signal: EStatusSignal }): Promise<void>
  clear(args: { ref: StatusSignalRef }): Promise<void>
}

export const STATUS_SIGNAL_ADAPTERS = Symbol('STATUS_SIGNAL_ADAPTERS')
export type StatusSignalAdapters = ReadonlyMap<EFactorySurface, StatusSignalAdapter>
