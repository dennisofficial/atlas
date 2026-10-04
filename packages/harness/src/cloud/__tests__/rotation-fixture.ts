import { ERuntimePhase, type SandboxRotationReceipt } from '@dltech/atlas-wire'

export const rotationReceipt = (over: Partial<SandboxRotationReceipt> = {}): SandboxRotationReceipt => ({
  version: 1,
  threadId: 'brn_cloud',
  sandboxSessionId: 'session-1',
  resumeParent: true,
  checkpoint: {
    threadId: 'brn_cloud', sandboxSessionId: 'session-1', runtimeId: 'runtime-1', revision: 1,
    phase: ERuntimePhase.Rotating, reportedAt: '2026-10-03T00:00:00Z',
    transcript: { head: 1, count: 1, digest: 'a'.repeat(64) },
  },
  ...over,
})
