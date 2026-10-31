import type { Event, EventLogPort, ThreadId } from '@dltech/atlas-core'

import type { CloudChannel } from '../cloud/cloud-bridge'
import { EConnectionView } from '../cloud/connection-view'
import { RemoteThreadStore } from '../cloud/remote-thread-store'
import type { RenameListener, ThreadStorePort, ThreadSummary } from '../store/thread-store'
import type { LocalPodTitles } from './local-pod-titles'

export class LocalPodThreadStore extends RemoteThreadStore {
  constructor(
    private readonly local: {
      channel: CloudChannel
      home: Pick<ThreadStorePort, 'find'>
      log: EventLogPort
      titles: LocalPodTitles
    },
  ) {
    super({
      channel: {
        request: (args) => local.channel.request(args),
        onThreadRenamed: () => () => undefined,
        onThreadModelChanged: (listener) => local.channel.onThreadModelChanged(listener),
      },
    })
  }

  async readTitleEvents(args: { threadId: ThreadId }): Promise<Event[]> {
    await this.local.log.refresh(args)
    return this.local.log.read(args)
  }

  override onRename(listener: RenameListener): () => void {
    return this.local.titles.onRename(listener)
  }

  override async rename(args: { threadId: ThreadId; title: string }): Promise<void> {
    if (args.threadId !== this.local.channel.threadId) return super.rename(args)
    await this.local.titles.rename({ title: args.title })
  }

  override async find(args: { threadId: ThreadId }): Promise<ThreadSummary | undefined> {
    const source =
      this.local.channel.connection().state === EConnectionView.Parked
        ? await this.local.home.find(args)
        : await super.find(args)
    if (source === undefined || args.threadId !== this.local.channel.threadId) return source
    const title = await this.local.titles.read()
    if (title.title === null) {
      const { title: _title, ...unnamed } = source
      return unnamed
    }
    return { ...source, title: title.title }
  }
}

export function readSessionTitleEvents(args: {
  threads: ThreadStorePort
  log: EventLogPort
  threadId: ThreadId
}): Promise<Event[]> {
  return args.threads instanceof LocalPodThreadStore
    ? args.threads.readTitleEvents({ threadId: args.threadId })
    : args.log.read({ threadId: args.threadId })
}
