import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  consumeSandboxRotationReceipt,
  persistRuntimeCheckpoint,
  readPersistedRuntimeCheckpoint,
  readSandboxRotationReceipt,
  runtimeCheckpointFile,
} from '../runtime-checkpoint'
import { ERuntimePhase } from '@dltech/atlas-wire'

describe("rotation receipt on the lifecycle record", () => {
  it('zeroes a parent obligation on the sealed receipt', async () => {
    const home = mkdtempSync(join(tmpdir(), 'probe-'))
    const receipt = {
      version: 1 as const,
      threadId: 't1',
      sandboxSessionId: 's1',
      resumeParent: true,
      checkpoint: {
        threadId: 't1', sandboxSessionId: 's1', runtimeId: 'r1', revision: 1,
        phase: ERuntimePhase.Updating as const, reportedAt: new Date().toISOString(),
        transcript: { head: 1, count: 1, digest: 'a'.repeat(64) },
      },
    }
    const file = runtimeCheckpointFile({ atlasHome: home })
    await persistRuntimeCheckpoint({ file, checkpoint: { ...receipt.checkpoint, receipt } })
    expect((await readSandboxRotationReceipt({ atlasHome: home }))?.resumeParent).toBe(true)
    await consumeSandboxRotationReceipt({ atlasHome: home, receipt, parent: true })
    expect((await readSandboxRotationReceipt({ atlasHome: home }))?.resumeParent).toBe(false)
    const record = await readPersistedRuntimeCheckpoint({ file })
    expect(record?.phase).toBe(ERuntimePhase.Updating)
  })
})
