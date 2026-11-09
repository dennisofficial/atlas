import type { OnApplicationBootstrap } from '@nestjs/common'
import type { SessionHolder } from '@dltech/atlas-host'

import type { FollowStack } from './follow-stack'
import type { HostWatchService } from './host-watch-service'
import type { StreamService } from './stream-service'

export type HostStartupServiceArgs = {
  holder: Pick<SessionHolder, 'start' | 'hostId' | 'ring'>
  watch: Pick<HostWatchService, 'start'>
  follow: Pick<FollowStack, 'open'>
  stream: Pick<StreamService, 'start'>
}

export class HostStartupService implements OnApplicationBootstrap {
  private readonly args: HostStartupServiceArgs

  constructor(args: HostStartupServiceArgs) {
    this.args = args
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.args.holder.start()
    this.args.watch.start({
      selfId: () => this.args.holder.hostId(),
      ring: () => this.args.holder.ring(),
    })
    this.args.stream.start({ subscriptions: this.args.follow.open() })
  }
}
