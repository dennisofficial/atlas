import { Sandbox, Snapshot } from '@vercel/sandbox'
import { SANDBOX_SNAPSHOT_RETENTION, type VercelCredentials } from '@dltech/atlas-wire'
import type {
  SandboxSnapshotStore,
  SandboxSummary,
  SnapshotSummary,
} from './sandbox-snapshot-store'

/** Vercel's list endpoints reject a limit above 50. */
const LIST_PAGE_LIMIT = 50

export class VercelSandboxSnapshotStore implements SandboxSnapshotStore {
  constructor(private readonly credentials: VercelCredentials) {}

  async listSandboxes(): Promise<SandboxSummary[]> {
    const pages = await Sandbox.list({ ...this.credentials, limit: LIST_PAGE_LIMIT })
    const sandboxes = await pages.toArray()
    return sandboxes.map((sandbox) => ({
      name: sandbox.name,
      currentSnapshotId: sandbox.currentSnapshotId,
      hasRetention: sandbox.keepLastSnapshots !== undefined,
    }))
  }

  async listSnapshots(): Promise<SnapshotSummary[]> {
    const pages = await Snapshot.list({ ...this.credentials, limit: LIST_PAGE_LIMIT })
    const snapshots = await pages.toArray()
    return snapshots.map((snapshot) => ({
      id: snapshot.id,
      createdAt: new Date(snapshot.createdAt),
      sizeBytes: snapshot.sizeBytes,
      status: snapshot.status,
    }))
  }

  async deleteSnapshot(args: { id: string }): Promise<void> {
    const snapshot = await Snapshot.get({ ...this.credentials, snapshotId: args.id })
    await snapshot.delete()
  }

  async applyRetention(args: { name: string }): Promise<void> {
    const sandbox = await Sandbox.get({ ...this.credentials, name: args.name, resume: false })
    await sandbox.update({ keepLastSnapshots: SANDBOX_SNAPSHOT_RETENTION })
  }
}
