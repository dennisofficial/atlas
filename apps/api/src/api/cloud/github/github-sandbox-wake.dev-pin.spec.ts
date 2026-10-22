import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fakeBoot,
  flushDebounce,
  PR_EVENT,
  readSandbox,
  releaseArtifactCheck,
  seedParkedSandbox,
  seedSubscription,
  serviceWith,
} from '../../../../test/github-sandbox-wake-fixture'
import { sandboxStateOf } from '../../platform/sandboxes/sandbox-lifecycle'
import { ESandboxState } from '../../platform/sandboxes/sandboxes.types'
import { DevServeInstallRefusedError } from './github-sandbox-wake-installer'

const DEV_PIN = 'dev-0123456789ab'

describe('GithubSandboxWakeService with a dev serve pin', () => {
  useTestDatabase()

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('boots the dev pin exactly, with no release lookup', async () => {
    const releaseCheck = releaseArtifactCheck(false)
    vi.stubGlobal('fetch', releaseCheck)
    await seedParkedSandbox({ serveVersion: DEV_PIN })
    await seedSubscription()
    const { boot, calls } = fakeBoot()

    serviceWith({ boot }).notifyEvent(PR_EVENT)
    await flushDebounce()

    expect(releaseCheck).not.toHaveBeenCalled()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.serveVersion).toBe(DEV_PIN)
    expect((await readSandbox()).state).toBe('running')
  })

  it('a dev pin the snapshot cannot satisfy fails the wake into backoff', async () => {
    await seedParkedSandbox({ serveVersion: DEV_PIN })
    await seedSubscription()
    const versions: Array<string | undefined> = []

    serviceWith({
      boot: {
        boot: async (bootArgs) => {
          versions.push(bootArgs.serveVersion)
          throw new DevServeInstallRefusedError({ name: bootArgs.name, version: DEV_PIN })
        },
      },
    }).notifyEvent(PR_EVENT)
    await flushDebounce()

    const held = await readSandbox()
    expect(versions).toEqual([DEV_PIN])
    expect(held.wakeClaim).toBeNull()
    expect(held.wakeFailedAt).toBeInstanceOf(Date)
    expect(sandboxStateOf(held)).toBe(ESandboxState.Parked)
  })
})
