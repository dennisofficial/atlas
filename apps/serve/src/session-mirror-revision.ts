import { type ServeFrame } from '@dltech/atlas-harness'

export type SessionMirrorRevision = {
  current(): number
  bump(): void
  bumpAndBroadcast(): void
}

export function createSessionMirrorRevision(args: {
  buffer: { push(signal: { type: 'session-files-changed'; revision: number }): ServeFrame }
  broadcast: (frame: ServeFrame) => void
  startsAt?: number | undefined
}): SessionMirrorRevision {
  let revision = args.startsAt ?? 0

  const bump = (): void => {
    revision += 1
  }

  return {
    current: () => revision,
    bump,
    bumpAndBroadcast() {
      bump()
      args.broadcast(args.buffer.push({ type: 'session-files-changed', revision }))
    },
  }
}
