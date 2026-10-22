import type { WireEvent } from '@dltech/atlas-wire/web'

export type LiveThreadState = { events: WireEvent[]; working: boolean; live: boolean }

export type LiveSend = (args: { text: string; requestId: string }) => boolean

export type LiveThreadView = LiveThreadState & { send: LiveSend }

export const IDLE_LIVE_THREAD: LiveThreadState = { events: [], working: false, live: false }
