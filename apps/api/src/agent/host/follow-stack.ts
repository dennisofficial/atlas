import type { ControlPlane } from '@dltech/atlas-control'
import type { Db } from '@dltech/atlas-db'
import type { LogPort, ProductAnalytics } from '@dltech/atlas-observability'

import { startPgChangeFeed, type PgChangeFeed } from '../bus/pg-change-feed'
import { createRedisLiveSource } from '../bus/redis-live-source'
import { sandboxLiveCpuMs } from '../sandbox/sandbox-live-cpu'
import { sandboxComputeFor } from '../sandbox/sandbox-runs'
import { databaseUrlWithTls } from '../config/database-url'
import type { AgentHostEnv } from '../config/env'
import { createFollowSubscriptions, type FollowSubscriptions } from '../stream/follow-port'
import type { LiveSource } from '../stream/live-source'
import { recordSessionSurface } from '../stream/session-surface'
import { systemHostTimers } from '../stream/system-timers'

export type FollowStackArgs = {
  env: AgentHostEnv
  db: Db
  plane: ControlPlane
  log: LogPort
  analytics?: ProductAnalytics | undefined
}

export class FollowStack {
  private feed: PgChangeFeed | undefined
  private live: LiveSource | undefined
  private follow: FollowSubscriptions | undefined
  private readonly args: FollowStackArgs

  constructor(args: FollowStackArgs) {
    this.args = args
  }

  open(): FollowSubscriptions {
    const feed = startPgChangeFeed({
      url: databaseUrlWithTls(this.args.env.databaseDirectUrl),
      log: this.args.log,
    })
    const live = createRedisLiveSource({ url: this.args.env.redisUrl, log: this.args.log })
    const follow = createFollowSubscriptions({
      plane: this.args.plane,
      feed,
      live,
      timers: systemHostTimers,
      log: this.args.log,
      ...(this.args.analytics === undefined ? {} : { analytics: this.args.analytics }),
      recordSurface: recordSessionSurface({ db: this.args.db }),
      compute: async ({ sessionId }) => {
        const cumulativeCpuMs = await sandboxLiveCpuMs({ sessionId })
        return sandboxComputeFor({
          sessionId,
          ...(cumulativeCpuMs === undefined ? {} : { cumulativeCpuMs }),
        })
      },
    })
    this.feed = feed
    this.live = live
    this.follow = follow
    return follow
  }

  async close(): Promise<void> {
    this.follow?.close()
    await this.live?.close()
    await this.feed?.close()
  }
}
