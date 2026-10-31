export type SandboxSummary = {
  name: string
  currentSnapshotId: string | undefined
  hasRetention: boolean
}

export type SnapshotSummary = {
  id: string
  createdAt: Date
  sizeBytes: number
  status: 'created' | 'failed' | 'deleted'
}

export type SandboxSnapshotStore = {
  listSandboxes: () => Promise<SandboxSummary[]>
  listSnapshots: () => Promise<SnapshotSummary[]>
  deleteSnapshot: (args: { id: string }) => Promise<void>
  applyRetention: (args: { name: string }) => Promise<void>
}
