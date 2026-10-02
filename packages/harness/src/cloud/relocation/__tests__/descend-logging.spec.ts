import * as fsPromises from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'bun:test'

import { ELogSeverity } from '@dltech/atlas-core'

import { CapturingLog } from './fake-log'
import { cloudArchiveOf, descend, useDescendHome } from './descend-fixture'
import { CLOUD_THREAD, fakeBridge } from './fixture'

const said = (text: string) => ({ type: 'user-said' as const, text })

describe('descend operational log', () => {
  it('warns durably when the cloud sandbox cannot be torn down', async () => {
    const home = useDescendHome()
    const archive = await cloudArchiveOf([{ drafts: [said('one')] }])
    const bridge = fakeBridge({ archive, destroyFails: new Error('the control plane fell over') })
    const log = new CapturingLog()

    await descend({ bridge, home, logPort: log })

    const entry = log.entries.find((one) => one.data?.['operation'] === 'destroy-sandbox')
    expect(entry?.severity).toBe(ELogSeverity.Warn)
    expect(entry?.source).toBe('cloud.descend')
    expect(entry?.threadId).toBe(CLOUD_THREAD)
    expect(entry?.error).toBe('the control plane fell over')
    expect(entry?.stack).toContain('the control plane fell over')
  })

  it('warns durably when the landed session directory cannot be read', async () => {
    const home = useDescendHome()
    const archive = await cloudArchiveOf([{ drafts: [said('one')] }])
    const bridge = fakeBridge({ archive })
    const log = new CapturingLog()
    const afterTranscriptLanded = async (): Promise<void> => {
      const homeDir = process.env['ATLAS_HOME']
      if (homeDir === undefined) return
      await fsPromises.rm(join(homeDir, 'sessions', CLOUD_THREAD), { recursive: true, force: true })
    }

    await descend({ bridge, home, logPort: log, afterTranscriptLanded }).catch(() => undefined)

    const entry = log.entries.find((one) => one.data?.['operation'] === 'read-landed-session-dir')
    expect(entry?.severity).toBe(ELogSeverity.Warn)
    expect(entry?.source).toBe('cloud.descend')
    expect(entry?.threadId).toBe(CLOUD_THREAD)
    expect(entry?.error).toContain('ENOENT')
    const failed = log.entries.find((one) => one.source === 'cloud.relocation')
    expect(failed?.severity).toBe(ELogSeverity.Error)
    expect(failed?.data).toEqual({ nodeId: 'confirmLocal', phase: 'pre-commit' })
  })
})
