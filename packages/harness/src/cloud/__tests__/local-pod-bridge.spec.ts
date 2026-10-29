import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'

import { WORKSPACE_SPEC_PATH } from '../local-cloud-bootstrap'
import { podNameFor } from '../local-pod/pod-create'
import { fakePodDriver, podBridgeWith } from './local-pod-bridge-fixture'

const threadId = toThreadId('thread-pod-bridge')
const serveToken = `serve-token-${threadId}`

describe('createLocalPodBridge birth', () => {
  it('registers the lease once, before the pod is created, then stages the spec', async () => {
    const { driver, events, created } = fakePodDriver({ created: true })
    const registered: Array<{ threadId: string; token: string }> = []
    const bridge = podBridgeWith({ driver, registered, events })

    const sandbox = await bridge.sandboxes.create({
      threadId,
      projectId: null,
    })

    expect(events).toEqual(['register', 'create', `write:${WORKSPACE_SPEC_PATH}`, 'launch'])
    expect(registered).toEqual([{ threadId, token: serveToken }])
    expect(created.map((one) => one.name)).toEqual([podNameFor({ threadId })])
    expect(sandbox).toMatchObject({
      url: 'http://127.0.0.1:20111',
      token: serveToken,
      created: true,
    })
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

  it('writes the birth effort into the workspace spec on a fresh boot', async () => {
    const { driver, writes } = fakePodDriver({ created: true })

    await podBridgeWith({ driver }).sandboxes.create({
      threadId,
      projectId: null,
      model: 'claude-x',
      birth: { effort: 'low' },
    })

    const spec = writes.find((write) => write.path === WORKSPACE_SPEC_PATH)
    expect(JSON.parse(String(spec?.content))).toMatchObject({ model: 'claude-x', effort: 'low' })
  })

  it('always hands the driver the serve token and the pod name', async () => {
    const { driver, created } = fakePodDriver({ created: false })

    await podBridgeWith({ driver }).sandboxes.create({ threadId, projectId: null })

    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({
      name: podNameFor({ threadId }),
      threadId,
      token: serveToken,
    })
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
    })

    expect(writes).toEqual([])
    expect(events).toEqual(['register', 'create', 'launch'])
    expect(registered).toEqual([{ threadId, token: serveToken }])
    expect(sandbox.created).toBe(false)
  })

  it('rejects a birth before touching Docker or the thread row when the lease cannot be registered', async () => {
    const { driver, events, writes } = fakePodDriver({ created: true })
    const bridge = podBridgeWith({
      driver,
      events,
      overrides: {
        registerPodLease: async () => {
          throw new Error('lease refused')
        },
        registerThread: async () => {
          events.push('thread')
        },
      },
    })

    await expect(
      bridge.sandboxes.create({ threadId, projectId: null, birth: { effort: 'low' } }),
    ).rejects.toThrow('lease refused')
    expect(events).toEqual([])
    expect(writes).toEqual([])
  })

  it('leaves the lease in place when Docker fails to create the pod', async () => {
    const { driver, events } = fakePodDriver({ created: true })
    driver.createOrResume = async () => {
      events.push('create')
      throw new Error('image pull failed')
    }
    const registered: Array<{ threadId: string; token: string }> = []

    await expect(
      podBridgeWith({
        driver,
        registered,
        events,
        overrides: {
          registerThread: async () => {
            events.push('thread')
          },
        },
      }).sandboxes.create({
        threadId,
        projectId: null,
        birth: { effort: 'low' },
      }),
    ).rejects.toThrow('image pull failed')

    expect(events).toEqual(['register', 'thread', 'create'])
    expect(registered).toEqual([{ threadId, token: serveToken }])
  })

  it('never touches Docker on a resume whose lease is refused', async () => {
    const { driver, events } = fakePodDriver({ created: false })

    await expect(
      podBridgeWith({
        driver,
        events,
        overrides: {
          registerPodLease: async () => {
            throw new Error('lease refused')
          },
        },
      }).sandboxes.create({ threadId, projectId: null }),
    ).rejects.toThrow('lease refused')

    expect(events).toEqual([])
  })

  it('registers the lease, then the born thread with its project, model and effort, before the pod is created', async () => {
    const { driver, events } = fakePodDriver({ created: true })
    const registeredThreads: unknown[] = []

    await podBridgeWith({
      driver,
      events,
      overrides: {
        registerThread: async (thread) => {
          events.push('thread')
          registeredThreads.push(thread)
        },
      },
    }).sandboxes.create({
      threadId,
      projectId: 'proj_1',
      model: 'claude-x',
      birth: { effort: 'high' },
    })

    expect(events).toEqual([
      'register',
      'thread',
      'create',
      `write:${WORKSPACE_SPEC_PATH}`,
      'launch',
    ])
    expect(registeredThreads).toEqual([
      { threadId, projectId: 'proj_1', model: 'claude-x', effort: 'high' },
    ])
  })

  it('registers no thread when the create carries no birth', async () => {
    const { driver } = fakePodDriver({ created: false })
    const registeredThreads: unknown[] = []

    await podBridgeWith({
      driver,
      overrides: {
        registerThread: async (thread) => {
          registeredThreads.push(thread)
        },
      },
    }).sandboxes.create({ threadId, projectId: null })

    expect(registeredThreads).toEqual([])
  })

  it('still boots the pod when the thread cannot be registered, and logs why', async () => {
    const { driver, created } = fakePodDriver({ created: true })
    const logged: string[] = []

    const sandbox = await podBridgeWith({
      driver,
      overrides: {
        registerThread: async () => {
          throw new Error('signed out')
        },
        onDriverLog: (line) => logged.push(line),
      },
    }).sandboxes.create({ threadId, projectId: null, birth: { effort: 'low' } })

    expect(created).toHaveLength(1)
    expect(sandbox.created).toBe(true)
    expect(logged).toEqual(['thread registration failed: signed out'])
  })

  it('still boots the pod when the registrar throws before returning a promise', async () => {
    const { driver, created } = fakePodDriver({ created: true })
    const logged: string[] = []

    await podBridgeWith({
      driver,
      overrides: {
        registerThread: () => {
          throw new Error('sign in to Atlas Cloud to start a session')
        },
        onDriverLog: (line) => logged.push(line),
      },
    }).sandboxes.create({ threadId, projectId: null, birth: { effort: 'low' } })

    expect(created).toHaveLength(1)
    expect(logged).toEqual([
      'thread registration failed: sign in to Atlas Cloud to start a session',
    ])
  })

  it('offers no sandbox registration, authorization, omission or checkpoint hooks', () => {
    const { driver } = fakePodDriver({ created: true })
    const bridge = podBridgeWith({ driver })

    expect(Object.keys(bridge.sandboxes).sort()).toEqual([
      'create',
      'destroy',
      'find',
      'readResources',
      'updateResources',
    ])
  })
})
