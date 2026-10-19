import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'
import { PORTABLE_STATE_PATH } from '@dltech/atlas-wire'

import { CONTEXT_ARCHIVE_PATH, WORKSPACE_SPEC_PATH } from '../local-cloud-bootstrap'
import { podNameFor } from '../local-pod/pod-create'
import type { SandboxTransferProgress } from '../transfer-progress'
import { fakePodDriver, podBridgeWith, portableState } from './local-pod-bridge-fixture'

const threadId = toThreadId('thread-pod-bridge')
const serveToken = `serve-token-${threadId}`

describe('createLocalPodBridge birth', () => {
  it('stages spec, portable state, then the archive in order, and registers the lease once after launch', async () => {
    const { driver, events, created } = fakePodDriver({ created: true })
    const registered: Array<{ threadId: string; token: string }> = []
    const bridge = podBridgeWith({
      driver,
      registered,
      events,
      overrides: { capturePortable: async () => portableState },
    })

    const sandbox = await bridge.sandboxes.create({
      threadId,
      workspace: { remoteUrl: 'git@github.com:comp-ai/atlas.git' },
      captureContext: async (put) => put(new Uint8Array(3)),
    })

    expect(events).toEqual([
      'create',
      `write:${WORKSPACE_SPEC_PATH}`,
      'vault-probe',
      `write:${PORTABLE_STATE_PATH}`,
      `write:${CONTEXT_ARCHIVE_PATH}`,
      'launch',
      'register',
    ])
    expect(registered).toEqual([{ threadId, token: serveToken }])
    expect(created.map((one) => one.name)).toEqual([podNameFor({ threadId })])
    expect(sandbox).toMatchObject({ url: 'http://127.0.0.1:20111', token: serveToken, created: true })
  })

  it('writes the remote url and model into the workspace spec', async () => {
    const { driver, writes } = fakePodDriver({ created: true })

    await podBridgeWith({ driver }).sandboxes.create({
      threadId,
      workspace: { remoteUrl: 'git@github.com:comp-ai/atlas.git' },
      model: 'claude-x',
    })

    const spec = writes.find((write) => write.path === WORKSPACE_SPEC_PATH)
    expect(JSON.parse(String(spec?.content))).toMatchObject({
      remoteUrl: 'git@github.com:comp-ai/atlas.git',
      model: 'claude-x',
    })
    expect(spec?.name).toBe(podNameFor({ threadId }))
  })

  it('always hands the driver the serve token and the pod name', async () => {
    const { driver, created } = fakePodDriver({ created: false })

    await podBridgeWith({ driver }).sandboxes.create({ threadId, workspace: null })

    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({ name: podNameFor({ threadId }), threadId, token: serveToken })
  })

  it('skips portable state and the archive when a vault is already in the pod', async () => {
    const { driver, writes } = fakePodDriver({ created: true, vaultPresent: true })
    let captured = 0
    let archived = 0

    await podBridgeWith({
      driver,
      overrides: {
        capturePortable: async () => {
          captured += 1
          return portableState
        },
      },
    }).sandboxes.create({
      threadId,
      workspace: null,
      captureContext: async () => {
        archived += 1
      },
    })

    expect(writes.map((write) => write.path)).toEqual([WORKSPACE_SPEC_PATH])
    expect([captured, archived]).toEqual([0, 0])
  })

  it('reports archive upload progress through the buffered transfer', async () => {
    const { driver } = fakePodDriver({ created: true })
    const progress: SandboxTransferProgress[] = []

    await podBridgeWith({ driver }).sandboxes.create({
      threadId,
      workspace: null,
      captureContext: async (put) => put(new Uint8Array(6)),
      onTransferProgress: (reading) => progress.push(reading),
    })

    expect(progress.map((reading) => [reading.transferredBytes, reading.complete])).toEqual([
      [0, false],
      [6, true],
    ])
    expect(progress[0]?.label).toBe('uploading skills and memory')
  })

  it('forwards the operator environment and omits it when empty', async () => {
    const withEnv = fakePodDriver({ created: true })
    const without = fakePodDriver({ created: true })

    await podBridgeWith({
      driver: withEnv.driver,
      overrides: { environment: () => ({ ATLAS_CLASSIFIER_MODE: 'nudge' }) },
    }).sandboxes.create({ threadId, workspace: null })
    await podBridgeWith({ driver: without.driver }).sandboxes.create({ threadId, workspace: null })

    expect(withEnv.created[0]?.environment).toEqual({ ATLAS_CLASSIFIER_MODE: 'nudge' })
    expect(without.created[0]?.environment).toBeUndefined()
  })

  it('stages nothing when the pod resumes, yet still registers the lease', async () => {
    const { driver, events, writes } = fakePodDriver({ created: false })
    const registered: Array<{ threadId: string; token: string }> = []
    let captured = 0

    const sandbox = await podBridgeWith({
      driver,
      registered,
      events,
      overrides: {
        capturePortable: async () => {
          captured += 1
          return portableState
        },
      },
    }).sandboxes.create({
      threadId,
      workspace: null,
      captureContext: async (put) => put(new Uint8Array(2)),
    })

    expect(writes).toEqual([])
    expect(captured).toBe(0)
    expect(events).toEqual(['create', 'launch', 'register'])
    expect(registered).toEqual([{ threadId, token: serveToken }])
    expect(sandbox.created).toBe(false)
  })

  it('rejects the create when the lease cannot be registered', async () => {
    const { driver } = fakePodDriver({ created: true })
    const bridge = podBridgeWith({
      driver,
      overrides: {
        registerPodLease: async () => {
          throw new Error('lease refused')
        },
      },
    })

    await expect(bridge.sandboxes.create({ threadId, workspace: null })).rejects.toThrow('lease refused')
  })

  it('does not register a lease when the pod never came up', async () => {
    const { driver } = fakePodDriver({ created: true })
    driver.createOrResume = async () => {
      throw new Error('boot failed')
    }
    const registered: Array<{ threadId: string; token: string }> = []

    await expect(podBridgeWith({ driver, registered }).sandboxes.create({ threadId, workspace: null })).rejects.toThrow(
      'boot failed',
    )

    expect(registered).toEqual([])
  })

  it('offers no sandbox registration, authorization, omission or checkpoint hooks', () => {
    const { driver } = fakePodDriver({ created: true })
    const bridge = podBridgeWith({ driver })

    expect(Object.keys(bridge.sandboxes).sort()).toEqual(['create', 'destroy', 'find', 'readResources', 'updateResources'])
  })
})
