import { EThreadStreamFrame } from '@dltech/atlas-wire'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { waitFor } from '../../../../test/fake-timers'
import { seedThreadRow, seedUsers } from '../../../../test/session-seed'
import { recordingSignals } from '../../platform/sessions/thread-signals.fixture'
import type { VercelSandboxClient } from '../../platform/sandboxes/vercel-sandbox.client'
import { EPodProvisionOutcome } from './pod-provision.contract'
import { runPodProvision } from './pod-provision-run'
import { fakeBoot, runDepsWith, sandboxRows, seedSandboxRow } from './sandbox-provisioning.fixture'
import { podServiceOver, realEndpoints } from './thread-pod.fixture'

const scope = { userId: 'usr-1', threadId: 'thr-1' }

const arrange = (args: { deleteFails?: Error } = {}) => {
  const remove = vi.fn(async (_target: { threadId: string; name: string }) => {
    if (args.deleteFails !== undefined) throw args.deleteFails
  })
  const vercel = { delete: remove } as unknown as VercelSandboxClient
  const { signals, framesOf } = recordingSignals()
  framesOf('thr-1')
  const service = podServiceOver(realEndpoints(), vercel, undefined, signals)
  return { service, remove, podFrames: () => framesOf('thr-1') }
}

describe('ThreadPodService.destroy', () => {
  useTestDatabase()

  beforeEach(async () => {
    await seedUsers('usr-1', 'usr-2')
    await seedThreadRow({ id: 'thr-1', userId: 'usr-1' })
  })

  it('deletes the sandbox by its stored name, then the row, and announces the change', async () => {
    await seedSandboxRow({
      state: 'running',
      serveUrl: 'https://serve.example.test',
    })
    const { service, remove, podFrames } = arrange()

    await expect(service.destroy(scope)).resolves.toBeUndefined()

    expect(remove).toHaveBeenCalledWith({
      threadId: 'thr-1',
      name: 'atlas-thread-1',
    })
    expect(await sandboxRows()).toHaveLength(0)
    expect(podFrames()).toContainEqual({ type: EThreadStreamFrame.Pod })
  })

  it('still deletes the row when Vercel says the sandbox is already gone', async () => {
    await seedSandboxRow({ state: 'parked', wakeClaim: null })
    const { service, remove } = arrange()

    await service.destroy(scope)

    expect(remove).toHaveBeenCalledTimes(1)
    expect(await sandboxRows()).toHaveLength(0)
  })

  it('keeps the row, stays quiet and rethrows when Vercel fails, so a retry can finish it', async () => {
    await seedSandboxRow({
      state: 'running',
      serveUrl: 'https://serve.example.test',
    })
    const failing = arrange({ deleteFails: new Error('vercel is down') })

    await expect(failing.service.destroy(scope)).rejects.toThrow('vercel is down')

    expect(await sandboxRows()).toHaveLength(1)
    expect(failing.podFrames()).toHaveLength(0)

    const retry = arrange()
    await retry.service.destroy(scope)
    expect(await sandboxRows()).toHaveLength(0)
  })

  it('does nothing for a thread with no sandbox row', async () => {
    const { service, remove, podFrames } = arrange()

    await expect(service.destroy(scope)).resolves.toBeUndefined()

    expect(remove).not.toHaveBeenCalled()
    expect(podFrames()).toHaveLength(0)
  })

  it('answers 404 for a thread someone else owns or one that does not exist, touching nothing', async () => {
    await seedSandboxRow({
      state: 'running',
      serveUrl: 'https://serve.example.test',
    })
    const { service, remove } = arrange()

    await expect(service.destroy({ userId: 'usr-2', threadId: 'thr-1' })).rejects.toMatchObject({
      status: 404,
    })
    await expect(service.destroy({ userId: 'usr-1', threadId: 'nope' })).rejects.toMatchObject({
      status: 404,
    })

    expect(remove).not.toHaveBeenCalled()
    expect(await sandboxRows()).toHaveLength(1)
  })

  it('stops an in-flight provision from marking the row running after the destroy', async () => {
    await seedSandboxRow()
    const [row] = await sandboxRows()
    const payload = {
      threadId: 'thr-1',
      wakeClaim: row?.wakeClaim?.toISOString() ?? '',
    }
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const { boot, calls } = fakeBoot({ held })
    const provision = runPodProvision({ payload, deps: runDepsWith({ boot }) })
    await waitFor(() => expect(calls).toHaveLength(1))

    await arrange().service.destroy(scope)
    release()

    expect(await provision).toEqual({
      outcome: EPodProvisionOutcome.Superseded,
    })
    expect(await sandboxRows()).toHaveLength(0)
  })

  it('keeps a failed destroy from letting an in-flight provision mark the row running', async () => {
    await seedSandboxRow()
    const [row] = await sandboxRows()
    const payload = { threadId: 'thr-1', wakeClaim: row?.wakeClaim?.toISOString() ?? '' }
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const { boot, calls } = fakeBoot({ held })
    const provision = runPodProvision({ payload, deps: runDepsWith({ boot }) })
    await waitFor(() => expect(calls).toHaveLength(1))

    await expect(
      arrange({ deleteFails: new Error('vercel is down') }).service.destroy(scope),
    ).rejects.toThrow('vercel is down')
    release()

    expect(await provision).toEqual({ outcome: EPodProvisionOutcome.Superseded })
    expect((await sandboxRows())[0]?.state).toBe('resuming')
  })
})
