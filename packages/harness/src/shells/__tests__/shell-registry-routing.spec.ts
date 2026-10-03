import { afterEach, describe, expect, it } from 'bun:test'

import type { SpawnCommand } from '@dltech/atlas-core'

import type { ShellAttachment, ShellLaunchOutcome, ShellLaunchSpec } from '../port'
import {
  closeRegistries,
  job,
  openRegistry,
  type ShellAdapter,
} from './shell-registry-fixture'
import { ShellLauncherPort } from '../port'

afterEach(closeRegistries)

describe('a background shell carrying its thread to the launcher', async () => {
  it('hands the owning thread to the launch, so a routed launcher can place it', async () => {
    const launched: ShellLaunchSpec[] = []
    const recordingLauncher = new (class extends ShellLauncherPort {
      async launch(spec: ShellLaunchSpec): Promise<ShellLaunchOutcome> {
        launched.push(spec)
        return {
          ok: false,
          reason: 'recording launcher never runs a real shell',
        }
      }
      async inspect(): Promise<readonly never[]> {
        return []
      }
    })()
    const recording: ShellAdapter = {
      name: 'recording',
      available: true,
      launcher: () => recordingLauncher,
      sweep: async () => {},
    }
    const { registry } = openRegistry({ adapter: recording })

    const started = await registry.start(job({ command: 'true' }))

    expect(started.ok).toBe(false)
    expect(launched[0]?.threadId).toBe(job({ command: 'true' }).threadId)
    expect(launched[0]?.command).toBe('true')
  })
})
