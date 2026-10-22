import { afterEach, beforeEach, describe, expect, it, mock, vi } from 'bun:test'
import { stubGlobal, unstubAllGlobals } from '@dltech/bun-test-shims'
import type { PrismaClient } from '../../../generated/prisma/client'

mock.module('../../../db', () => ({ db: fakeGithubDb().db as unknown as PrismaClient }))

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
import { fakeGithubDb } from '../../../../test/fake-github-db.js'

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
    vi.useRealTimers()
    unstubAllGlobals()
  })

  it('boots the dev pin exactly, with no release lookup', async () => {
    const releaseCheck = releaseArtifactCheck(false)
    stubGlobal('fetch', releaseCheck)
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
