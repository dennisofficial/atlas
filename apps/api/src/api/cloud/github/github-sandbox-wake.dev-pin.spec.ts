import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../../generated/prisma/client'

vi.mock('../../../db', async () => {
  const { fakeGithubDb } = await import('../../../../test/fake-github-db.js')
  return { db: fakeGithubDb().db as unknown as PrismaClient }
})

import {
  fake,
  fakeBoot,
  flushDebounce,
  PR_EVENT,
  releaseArtifactCheck,
  seedParkedSandbox,
  seedSubscription,
  serviceWith,
} from '../../../../test/github-sandbox-wake-fixture'
import { sandboxStateOf } from '../../platform/sandboxes/sandbox-lifecycle'
import { ESandboxState } from '../../platform/sandboxes/sandboxes.types'
import { DevServeInstallRefusedError } from './github-sandbox-wake-installer'

const DEV_PIN = 'dev-0123456789ab'

const row = () => {
  const held = fake.cloudSandboxes[0]
  if (held === undefined) throw new Error('no seeded sandbox row')
  return held as Parameters<typeof sandboxStateOf>[0] & typeof held
}

describe('GithubSandboxWakeService with a dev serve pin', () => {
  beforeEach(() => {
    fake.reset()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('boots the dev pin without checking for a release artifact', async () => {
    const releaseCheck = releaseArtifactCheck(false)
    vi.stubGlobal('fetch', releaseCheck)
    seedSubscription()
    seedParkedSandbox({ serveVersion: DEV_PIN })
    const { boot, calls } = fakeBoot()

    serviceWith({ boot }).notifyEvent(PR_EVENT)
    await flushDebounce()

    expect(releaseCheck).not.toHaveBeenCalled()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.serveVersion).toBe(DEV_PIN)
    expect(row().state).toBe('running')
  })

  it('a dev pin the snapshot cannot satisfy fails the wake into backoff', async () => {
    vi.stubGlobal('fetch', releaseArtifactCheck(true))
    seedSubscription()
    seedParkedSandbox({ serveVersion: DEV_PIN })
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

    expect(versions).toEqual([DEV_PIN])
    expect(row().wakeClaim).toBeNull()
    expect(row().wakeFailedAt).toEqual(expect.any(String))
    expect(sandboxStateOf(row())).toBe(ESandboxState.Parked)
  })
})
