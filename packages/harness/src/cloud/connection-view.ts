import { ERuntimePhase } from '@dltech/atlas-wire'

export enum EConnectionView {
  Connected = 'connected',
  Waking = 'waking',
  Reconnecting = 'reconnecting',
  Updating = 'updating',
  Disconnected = 'disconnected',
  Detached = 'detached',
  Parked = 'parked',
}

/** The channel's own socket, as the transport sees it: greeted is Open, never-attached is Unattached. */
export enum ESocketLiveness {
  Unattached = 'unattached',
  Dialing = 'dialing',
  Open = 'open',
  Closed = 'closed',
}

export type ConnectionView = { state: EConnectionView; detail: string | null }

export type ConnectionFacts = {
  phase: ERuntimePhase | null
  socket: ESocketLiveness
  waking: boolean
  failure: string | null
  detached: boolean
}

const view = (state: EConnectionView, detail: string | null = null): ConnectionView => ({ state, detail })

const restingPhase = (phase: ERuntimePhase | null): boolean =>
  phase === ERuntimePhase.Parked || phase === ERuntimePhase.Parking

export function connectionViewOf(facts: ConnectionFacts): ConnectionView {
  if (facts.detached) return view(EConnectionView.Detached)
  if (facts.socket === ESocketLiveness.Open) {
    return facts.phase === ERuntimePhase.Parked ? view(EConnectionView.Parked) : view(EConnectionView.Connected)
  }
  if (facts.waking) return view(EConnectionView.Waking)
  if (facts.failure !== null) return view(EConnectionView.Disconnected, facts.failure)
  if (restingPhase(facts.phase)) return view(EConnectionView.Parked)
  if (facts.phase === ERuntimePhase.Waking || facts.phase === ERuntimePhase.Provisioning) {
    return view(EConnectionView.Waking)
  }
  if (facts.phase === ERuntimePhase.Updating) return view(EConnectionView.Updating, 'updating the cloud sandbox')
  if (facts.socket === ESocketLiveness.Unattached) return view(EConnectionView.Parked)
  return view(EConnectionView.Reconnecting)
}

export const sameConnectionView = (args: { left: ConnectionView; right: ConnectionView }): boolean =>
  args.left.state === args.right.state && args.left.detail === args.right.detail

const WAKES_ON_SEND: ReadonlySet<EConnectionView> = new Set([
  EConnectionView.Parked,
  EConnectionView.Waking,
  EConnectionView.Updating,
  EConnectionView.Disconnected,
])

/** A send in one of these states queues locally and wakes the sandbox instead of hitting the wire. */
export const wakesOnSend = (state: EConnectionView): boolean => WAKES_ON_SEND.has(state)

const IN_TRANSITION: ReadonlySet<EConnectionView> = new Set([
  EConnectionView.Waking,
  EConnectionView.Reconnecting,
  EConnectionView.Updating,
])

/** The container is mid-move: the UI shows a spinner and names what it is doing. */
export const isTransitioning = (state: EConnectionView): boolean => IN_TRANSITION.has(state)
