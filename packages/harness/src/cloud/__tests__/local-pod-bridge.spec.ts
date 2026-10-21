import { describe, expect, it } from 'vitest'

import { toThreadId } from '@dltech/atlas-core'

import { CONTEXT_ARCHIVE_PATH, WORKSPACE_SPEC_PATH } from '../local-cloud-bootstrap'
import { podNameFor } from '../local-pod/pod-create'
import type { SandboxTransferProgress } from '../transfer-progress'
import { fakePodDriver, podBridgeWith } from './local-pod-bridge-fixture'

const threadId = toThreadId('thread-pod-bridge')
const serveToken = `serve-token-${threadId}`

describe('createLocalPodBridge birth', () => {
  it('stages the spec, then the archive in order, and registers the lease before the bootstrap write and again after launch', async () => {
    const { driver, events, created } = fakePodDriver({ created: true })
    const registered: Array<{ threadId: string; token: string }> = []
    const bridge = podBridgeWith({ driver, registered, events })

    const sandbox = await bridge.sandboxes.create({
      threadId,
      projectId: null,
      captureContext: async (put) => put(new Uint8Array(3)),
    })

    expect(events).toEqual([
      'create',
      'register',
      `write:${WORKSPACE_SPEC_PATH}`,
      'vault-probe',
      `write:${CONTEXT_ARCHIVE_PATH}`,
      'launch',
      'register',
    ])
    expect(registered).toEqual([
      { threadId, token: serveToken },
      { threadId, token: serveToken },
    ])
    expect(created.map((one) => one.name)).toEqual([podNameFor({ threadId })])
    expect(sandbox).toMatchObject({ url: 'http://127.0.0.1:20111', token: serveToken, created: true })
  })

  it('writes the project id and model into the workspace spec', async () => {
    const { driver, writes } = fakePodDriver({ created: true })

    await podBridgeWith({ driver }).sandboxes.create({
      threadId,
      projectId: 'proj_1',
      model: 'claude-x',
    })

    const spec = writes.find((write) => write.path === WORKSPACE_SPEC_PATH)
    expect(JSON.parse(String(spec?.content))).toEqual({
      remoteUrl: null,
      githubToken: null,
      projectId: 'proj_1',
      model: 'claude-x',
    })
    expect(spec?.name).toBe(podNameFor({ threadId }))
  })

  it('always hands the driver the serve token and the pod name', async () => {
    const { driver, created } = fakePodDriver({ created: false })

    await podBridgeWith({ driver }).sandboxes.create({ threadId, projectId: null })

    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({ name: podNameFor({ threadId }), threadId, token: serveToken })
  })

  it('skips the archive when a vault is already in the pod', async () => {
    const { driver, writes } = fakePodDriver({ created: true, vaultPresent: true })
    let archived = 0

    await podBridgeWith({ driver }).sandboxes.create({
      threadId,
      projectId: null,
      captureContext: async () => {
        archived += 1
      },
    })

    expect(writes.map((write) => write.path)).toEqual([WORKSPACE_SPEC_PATH])
    expect(archived).toBe(0)
  })

  it('reports archive upload progress through the buffered transfer', async () => {
    const { driver } = fakePodDriver({ created: true })
    const progress: SandboxTransferProgress[] = []

    await podBridgeWith({ driver }).sandboxes.create({
      threadId,
      projectId: null,
      captureContext: async (put) => put(new Uint8Array(6)),
      onTransferProgress: (reading) => progress.push(reading),
    })

    expect(progress.map((reading) => [reading.transferredBytes, reading.complete])).toEqual([
      [0, false],
      [6, true],
    ])
    expect(progress[0]?.label).toBe('uploading local config')
  })

  it('forwards the operator environment and omits it when empty', async () => {
    const withEnv = fakePodDriver({ created: true })
    const without = fakePodDriver({ created: true })

    await podBridgeWith({
      driver: withEnv.driver,
      overrides: { environment: () => ({ ATLAS_CLASSIFIER_MODE: 'nudge' }) },
    }).sandboxes.create({ threadId, projectId: null })
    await podBridgeWith({ driver: without.driver }).sandboxes.create({ threadId, projectId: null })

    expect(withEnv.created[0]?.environment).toEqual({ ATLAS_CLASSIFIER_MODE: 'nudge' })
    expect(without.created[0]?.environment).toBeUndefined()
  })

  it('stages nothing when the pod resumes, yet still registers the lease', async () => {
    const { driver, events, writes } = fakePodDriver({ created: false })
    const registered: Array<{ threadId: string; token: string }> = []

    const sandbox = await podBridgeWith({ driver, registered, events }).sandboxes.create({
      threadId,
      projectId: null,
      captureContext: async (put) => put(new Uint8Array(2)),
    })

    expect(writes).toEqual([])
    expect(events).toEqual(['create', 'launch', 'register'])
    expect(registered).toEqual([{ threadId, token: serveToken }])
    expect(sandbox.created).toBe(false)
  })

  it('rejects a fresh birth before any bootstrap write or launch when the lease cannot be registered', async () => {
    const { driver, events, writes } = fakePodDriver({ created: true })
    const bridge = podBridgeWith({
      driver,
      events,
      overrides: {
        registerPodLease: async () => {
          throw new Error('lease refused')
        },
      },
    })

    await expect(bridge.sandboxes.create({ threadId, projectId: null })).rejects.toThrow('lease refused')
    expect(events).toEqual(['create'])
    expect(writes).toEqual([])
  })

  it('registers nothing when the driver refuses a resume without staging', async () => {
    const { driver } = fakePodDriver({ created: false })
    driver.createOrResume = async () => {
      throw new Error('token refused')
    }
    const registered: Array<{ threadId: string; token: string }> = []

    await expect(podBridgeWith({ driver, registered }).sandboxes.create({ threadId, projectId: null })).rejects.toThrow(
      'token refused',
    )

    expect(registered).toEqual([])
  })

  it('offers no sandbox registration, authorization, omission or checkpoint hooks', () => {
    const { driver } = fakePodDriver({ created: true })
    const bridge = podBridgeWith({ driver })

    expect(Object.keys(bridge.sandboxes).sort()).toEqual(['create', 'destroy', 'find', 'readResources', 'updateResources'])
  })
})
