import type { TransportRetryLog } from './cloud-transport'

const SOURCE = 'cloud.pull-requests'

export type SessionHealth = {
  isDead: () => boolean
  noteDead: () => void
  noteAlive: () => void
}

export function createSessionHealth(args: { log: TransportRetryLog | undefined }): SessionHealth {
  let dead = false

  return {
    isDead: () => dead,
    noteDead: () => {
      if (dead) return
      dead = true
      args.log?.port.warn({
        source: SOURCE,
        message:
          'the cloud API rejected the pull request session; realtime tracking is retrying with backoff',
      })
    },
    noteAlive: () => {
      if (!dead) return
      dead = false
      args.log?.port.info({
        source: SOURCE,
        message: 'the cloud API accepts the pull request session again; realtime tracking resumed',
      })
    },
  }
}
