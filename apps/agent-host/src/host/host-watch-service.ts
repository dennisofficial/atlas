import type { LogPort } from '@dltech/atlas-observability'

import type { PgWakeListener } from '../bus/pg-wake-listener'
import { databaseUrlWithTls } from '../config/database-url'
import type { AgentHostEnv } from '../config/env'
import { startHostWatch, type HostWatch } from '../presence/pg-host-watch'

export type HostWatchServiceArgs = {
  env: AgentHostEnv
  wakes: PgWakeListener
  log: LogPort
}

export type HostWatchStartArgs = {
  selfId: () => number | undefined
  ring: () => void
}

export class HostWatchService {
  private watch: HostWatch | undefined
  private readonly args: HostWatchServiceArgs

  constructor(args: HostWatchServiceArgs) {
    this.args = args
  }

  start(startArgs: HostWatchStartArgs): HostWatch {
    const watch = startHostWatch({
      url: databaseUrlWithTls(this.args.env.databaseDirectUrl),
      selfId: startArgs.selfId,
      ring: startArgs.ring,
      onHostChange: (listener) => this.args.wakes.onHostChange(listener),
      log: this.args.log,
    })
    this.watch = watch
    return watch
  }

  recompute(): void {
    this.watch?.recompute()
  }

  async close(): Promise<void> {
    await this.watch?.close()
  }
}
