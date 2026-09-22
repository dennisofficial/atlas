import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'

import { ECloudSandboxState, type CloudSandboxes } from '../cloud-bridge'
import { parkedEscalationOf } from '../create-bridge'

const THREAD = toThreadId('brn_cloud')

const sandboxesFinding = (
  find: CloudSandboxes['find'],
): Pick<CloudSandboxes, 'find'> => ({ find })

describe('parkedEscalationOf', () => {
  it('escalates when the driver reports the sandbox parked', async () => {
    const sandboxes = sandboxesFinding(async () => ({ state: ECloudSandboxState.Parked }))

    expect(await parkedEscalationOf({ sandboxes, threadId: THREAD })()).toBe(true)
  })

  it('stays put for a sandbox that is running', async () => {
    const sandboxes = sandboxesFinding(async () => ({
      state: ECloudSandboxState.Running,
      url: 'https://box.vercel.run',
    }))

    expect(await parkedEscalationOf({ sandboxes, threadId: THREAD })()).toBe(false)
  })

  it('stays put for a sandbox that is only resuming', async () => {
    const sandboxes = sandboxesFinding(async () => ({ state: ECloudSandboxState.Resuming }))

    expect(await parkedEscalationOf({ sandboxes, threadId: THREAD })()).toBe(false)
  })

  it('swallows a driver failure rather than escalating on a guess', async () => {
    const sandboxes = sandboxesFinding(async () => {
      throw new Error('vercel said no')
    })

    expect(await parkedEscalationOf({ sandboxes, threadId: THREAD })()).toBe(false)
  })
})
