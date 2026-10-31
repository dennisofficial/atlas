import type { ThreadId } from '@dltech/atlas-core'

import { EClientRequest, readThreadReplySchema } from '../cloud/channel-wire'
import { EConnectionView } from '../cloud/connection-view'
import type { CloudChannel } from '../cloud/cloud-bridge'
import { FileLocalThreadTitles } from '../store/sessions/local-thread-titles'
import type { LocalTitleState } from '../store/sessions/local-title-state'
import type { RenameListener } from '../store/thread-store'

export type LocalTitleStorage = Pick<FileLocalThreadTitles, 'read' | 'renameUser' | 'proposeAuto'>

export class LocalPodTitles {
  private readonly listeners = new Set<RenameListener>()
  private chain: Promise<void> = Promise.resolve()
  private stopped = false

  constructor(
    private readonly args: {
      threadId: ThreadId
      storage: LocalTitleStorage
      channel: () => CloudChannel | undefined
    },
  ) {}

  read(): Promise<LocalTitleState> {
    return this.args.storage.read({ threadId: this.args.threadId })
  }

  onRename(listener: RenameListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async rename(args: { title: string }): Promise<void> {
    const state = await this.args.storage.renameUser({ threadId: this.args.threadId, ...args })
    this.emit(state)
    this.queue(() => this.forward())
  }

  observe(args: { title: string }): void {
    const baseline = this.read()
    this.queue(async () => {
      const before = await baseline
      const next = await this.args.storage.proposeAuto({
        threadId: this.args.threadId,
        title: args.title,
        expectedRevision: before.revision,
      })
      if (next.revision !== before.revision) this.emit(next)
      if (next.title !== args.title) await this.forward()
    })
  }

  reconcile(): void {
    const baseline = this.read()
    this.queue(async () => {
      const before = await baseline
      const request = this.connected()?.requestIfConnected?.({
        op: EClientRequest.ReadThread,
        params: { threadId: this.args.threadId },
      })
      if (request === undefined) return
      const reply = readThreadReplySchema.parse(await request)
      if (reply.thread?.title !== undefined) {
        const next = await this.args.storage.proposeAuto({
          threadId: this.args.threadId,
          title: reply.thread.title,
          expectedRevision: before.revision,
        })
        if (next.revision !== before.revision) this.emit(next)
      }
      await this.forward()
    })
  }

  settled(): Promise<void> {
    return this.chain
  }

  stop(): void {
    this.stopped = true
    this.listeners.clear()
  }

  private connected(): CloudChannel | undefined {
    const channel = this.args.channel()
    return channel?.connection().state === EConnectionView.Connected ? channel : undefined
  }

  private async forward(): Promise<void> {
    let state = await this.read()
    while (!this.stopped && state.title !== null) {
      const sent = this.connected()?.requestIfConnected?.({
        op: EClientRequest.RenameThread,
        params: { threadId: this.args.threadId, title: state.title },
      })
      if (sent === undefined) return
      await sent
      const latest = await this.read()
      if (latest.revision === state.revision) return
      state = latest
    }
  }

  private emit(state: LocalTitleState): void {
    if (state.title === null || this.stopped) return
    for (const listener of [...this.listeners])
      listener({ threadId: this.args.threadId, title: state.title })
  }

  private queue(task: () => Promise<void>): void {
    this.chain = this.chain.then(async () => {
      if (!this.stopped) await task().catch(() => undefined)
    })
  }
}

export function createLocalPodTitles(args: {
  home: string
  threadId: ThreadId
  channel?: (() => CloudChannel | undefined) | undefined
}): LocalPodTitles {
  return new LocalPodTitles({
    threadId: args.threadId,
    storage: new FileLocalThreadTitles({ home: args.home }),
    channel: args.channel ?? (() => undefined),
  })
}
