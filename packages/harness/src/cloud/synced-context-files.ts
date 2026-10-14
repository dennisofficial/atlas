import type { DirectoryEntry } from '@dltech/atlas-core'

import type { ContextFileContent } from '../files/context-browser'
import type { ContextReader } from '../files/session-context'
import type { SessionMirrorSync } from './session-mirror-syncer'

export class SyncedContextFiles implements ContextReader {
  private readonly local: ContextReader
  private readonly remote: ContextReader
  private readonly mirror: Pick<SessionMirrorSync, 'subscribe' | 'converge' | 'current'>

  constructor(args: {
    local: ContextReader
    remote: ContextReader
    mirror: Pick<SessionMirrorSync, 'subscribe' | 'converge' | 'current'>
  }) {
    this.local = args.local
    this.remote = args.remote
    this.mirror = args.mirror
  }

  async list(directory?: string): Promise<readonly DirectoryEntry[]> {
    await this.converge()
    const mirrored = await this.local.list(directory)
    if (mirrored.length > 0) return mirrored
    return this.remote.list(directory).catch(() => mirrored)
  }

  async load(path: string): Promise<ContextFileContent> {
    await this.converge()
    const mirrored = await this.local.load(path)
    if (mirrored.type !== 'refused') return mirrored
    return this.remote.load(path).catch(() => mirrored)
  }

  subscribe(listener: () => void): () => void {
    return this.mirror.subscribe(listener)
  }

  private async converge(): Promise<void> {
    await this.mirror.converge().catch(() => undefined)
  }
}
