import type {
  SandboxSnapshotStore,
  SandboxSummary,
  SnapshotSummary,
} from './sandbox-snapshot-store'

export class FakeSandboxSnapshotStore implements SandboxSnapshotStore {
  sandboxes: SandboxSummary[] = []
  snapshots: SnapshotSummary[] = []
  readonly deletedIds: string[] = []
  readonly retentionNames: string[] = []
  failDeleteIds = new Set<string>()
  failRetentionNames = new Set<string>()

  async listSandboxes(): Promise<SandboxSummary[]> {
    return this.sandboxes
  }

  async listSnapshots(): Promise<SnapshotSummary[]> {
    return this.snapshots
  }

  async deleteSnapshot(args: { id: string }): Promise<void> {
    if (this.failDeleteIds.has(args.id)) throw new Error('delete failed')
    this.deletedIds.push(args.id)
  }

  async applyRetention(args: { name: string }): Promise<void> {
    if (this.failRetentionNames.has(args.name)) throw new Error('retention failed')
    this.retentionNames.push(args.name)
  }
}
