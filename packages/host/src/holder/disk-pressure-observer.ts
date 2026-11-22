import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import type { RemoteCalls } from '../calls/remote-calls'
import type { PodDiskPressurePort } from './ports'

export type DiskPressureObserverArgs = {
  remoteCalls: RemoteCalls
  sessionId: string
  podSessionId: string
  port: PodDiskPressurePort | undefined
  log?: LogPort | undefined
}

export class DiskPressureObserver {
  private unsubscribe: (() => void) | undefined
  private readonly args: DiskPressureObserverArgs

  constructor(args: DiskPressureObserverArgs) {
    this.args = args
  }

  start(): void {
    const port = this.args.port
    if (port === undefined || this.unsubscribe !== undefined) return
    this.unsubscribe = this.args.remoteCalls.onEvent((frame) => {
      if (frame.event.type !== 'pod.disk-pressure') return
      const { usedBytes, limitBytes, pressure } = frame.event
      void port
        .report({
          sessionId: this.args.sessionId,
          podSessionId: this.args.podSessionId,
          usedBytes,
          limitBytes,
          pressure,
        })
        .catch((error: unknown) => this.faulted(error))
    })
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = undefined
  }

  private faulted(error: unknown): void {
    this.args.log?.error({
      source: 'holder.disk-pressure',
      message: `reporting the disk of ${this.args.podSessionId} failed`,
      ...logFieldsOf({ error }),
    })
  }
}
