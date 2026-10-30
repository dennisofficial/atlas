import type { NestExpressApplication } from '@nestjs/platform-express'
import {
  channelTicketValid,
  EBootStep,
  EBootStepState,
  EPodResizeApplies,
  EPodState,
  podConnectReplySchema,
  podResizeReplySchema,
  podStatusSchema,
} from '@dltech/atlas-wire'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'bun:test'
import { seedSandboxRow, seedThreadRow, seedUsers } from '../../../../test/session-seed'
import { BackgroundWork } from '../../../_core/ports/background-work'
import { SandboxEndpointService } from '../../platform/sandboxes/sandbox-endpoint'
import { recordBootSteps } from '../../platform/sandboxes/sandbox-boot-steps'
import { callMutation, callQuery, createRouterApp } from './sandbox-provisioning.router.fixture'
import { VercelSandboxClient } from '../../platform/sandboxes/vercel-sandbox.client'
import { SandboxesService } from '../../platform/sandboxes/sandboxes.service'
import { inertSignals } from '../../platform/sessions/thread-signals.fixture'
import { ThreadSignalsService } from '../../platform/sessions/thread-signals.service'
import { PodLaunchService } from './pod-launch.service'
import { ThreadPodRouter } from './thread-pod.router'
import { ThreadPodService } from './thread-pod.service'
import {
  RecordingBackground,
  realEndpoints,
  SERVE_TOKEN,
  SERVE_URL,
  seedServingPod,
} from './thread-pod.fixture'

const sandboxRows = () => db.orm.public.CloudSandbox.all()

const resizableVercel = {
  inspect: async () => ({ state: 'parked' }),
  readResources: async () => ({ vcpus: 2, memoryMb: 4096 }),
  updateResources: async () => undefined,
  delete: vi.fn(async (_target: { threadId: string; name: string }) => undefined),
}

describe('ThreadPodRouter', () => {
  useTestDatabase()
  let app: NestExpressApplication

  beforeAll(async () => {
    app = await createRouterApp([
      ThreadPodRouter,
      ThreadPodService,
      { provide: SandboxEndpointService, useValue: realEndpoints() },
      { provide: VercelSandboxClient, useValue: resizableVercel },
      { provide: SandboxesService, useValue: {} },
      { provide: PodLaunchService, useValue: {} },
      { provide: ThreadSignalsService, useValue: inertSignals() },
      { provide: BackgroundWork, useValue: new RecordingBackground() },
    ])
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    resizableVercel.delete.mockClear()
    await seedUsers('usr-1', 'usr-2')
    await seedThreadRow({ id: 'thr-1', userId: 'usr-1' })
  })

  const get = (token?: string, input: unknown = { threadId: 'thr-1' }) =>
    callQuery({
      app,
      procedure: 'threadPod.status',
      input,
      ...(token === undefined ? {} : { token }),
    })

  it('answers 401 without a session', async () => {
    expect((await get()).status).toBe(401)
  })

  it('answers 400 for an empty thread id', async () => {
    expect((await get('session-a', { threadId: '' })).status).toBe(400)
  })

  it("answers 404 for someone else's thread", async () => {
    expect((await get('session-b')).status).toBe(404)
  })

  it('answers the owner the pod status in wire shape', async () => {
    await recordBootSteps({
      threadId: 'thr-1',
      steps: [{ step: EBootStep.Provision, state: EBootStepState.Error, error: 'no credential' }],
    })

    const reply = await get('session-a')

    expect(reply.status).toBe(200)
    const pod = podStatusSchema.parse(reply.body.result.data)
    expect(pod.state).toBe(EPodState.Failed)
    expect(pod.steps).toMatchObject([
      { step: EBootStep.Provision, state: EBootStepState.Error, error: 'no credential' },
    ])
  })

  describe('connect', () => {
    const post = (token?: string, input: unknown = { threadId: 'thr-1' }) =>
      callMutation({
        app,
        procedure: 'threadPod.connect',
        input,
        ...(token === undefined ? {} : { token }),
      })

    it('answers 401 without a session', async () => {
      expect((await post()).status).toBe(401)
    })

    it('answers 400 for an empty thread id', async () => {
      expect((await post('session-a', { threadId: '' })).status).toBe(400)
    })

    it("answers 404 for someone else's thread", async () => {
      await seedServingPod({ threadId: 'thr-1', userId: 'usr-1' })

      expect((await post('session-b')).status).toBe(404)
    })

    it('answers 409 pod-not-running when nothing is running', async () => {
      const reply = await post('session-a')

      expect(reply.status).toBe(409)
      expect(reply.body.error.data.details).toMatchObject({ code: 'pod-not-running' })
    })

    it('answers 409 pod-not-running for a parked pod', async () => {
      await seedServingPod({ threadId: 'thr-1', userId: 'usr-1', state: 'parked' })

      const reply = await post('session-a')

      expect(reply.status).toBe(409)
      expect(reply.body.error.data.details).toMatchObject({ code: 'pod-not-running' })
    })

    it('answers 200 with a ticket for the serve token, and never the token itself', async () => {
      await seedServingPod({ threadId: 'thr-1', userId: 'usr-1' })

      const reply = await post('session-a')

      expect(reply.status).toBe(200)
      const connect = podConnectReplySchema.parse(reply.body.result.data)
      expect(connect.url).toBe(SERVE_URL)
      expect(
        channelTicketValid({
          serveToken: SERVE_TOKEN,
          threadId: 'thr-1',
          ticket: connect.token,
          nowMs: Date.now(),
        }),
      ).toBe(true)
      expect(JSON.stringify(reply.body)).not.toContain(SERVE_TOKEN)
      expect(reply.text).not.toContain(SERVE_TOKEN)
    })
  })

  describe('resize', () => {
    const post = (token?: string, input: unknown = { threadId: 'thr-1', vcpus: 4 }) =>
      callMutation({
        app,
        procedure: 'threadPod.resize',
        input,
        ...(token === undefined ? {} : { token }),
      })

    it('answers 401 without a session', async () => {
      expect((await post()).status).toBe(401)
    })

    it('answers 400 for a size outside the vCPU steps', async () => {
      expect((await post('session-a', { threadId: 'thr-1', vcpus: 3 })).status).toBe(400)
      expect((await post('session-a', { threadId: 'thr-1', vcpus: 16 })).status).toBe(400)
    })

    it("answers 404 for someone else's thread", async () => {
      await seedServingPod({ threadId: 'thr-1', userId: 'usr-1' })

      expect((await post('session-b')).status).toBe(404)
    })

    it('answers the owner the applied size and when it lands', async () => {
      await seedSandboxRow({ threadId: 'thr-1', userId: 'usr-1', state: 'parked' })
      await recordBootSteps({
        threadId: 'thr-1',
        steps: [{ step: EBootStep.Provision, state: EBootStepState.Done }],
      })

      const reply = await post('session-a')

      expect(reply.status).toBe(200)
      expect(podResizeReplySchema.parse(reply.body.result.data)).toEqual({
        vcpus: 4,
        appliesAt: EPodResizeApplies.Live,
      })
    })
  })

  describe('destroy', () => {
    const post = (token?: string, input: unknown = { threadId: 'thr-1' }) =>
      callMutation({
        app,
        procedure: 'threadPod.destroy',
        input,
        ...(token === undefined ? {} : { token }),
      })

    it('answers 401 without a session', async () => {
      await seedServingPod({ threadId: 'thr-1', userId: 'usr-1' })

      expect((await post()).status).toBe(401)
      expect(await sandboxRows()).toHaveLength(1)
    })

    it('refuses a sandbox token, which is not a user session', async () => {
      await seedServingPod({ threadId: 'thr-1', userId: 'usr-1' })

      const reply = await post('sandbox-token-of-thr-1')

      expect(reply.status).toBe(401)
      expect(resizableVercel.delete).not.toHaveBeenCalled()
      expect(await sandboxRows()).toHaveLength(1)
    })

    it('answers 400 for an empty thread id', async () => {
      expect((await post('session-a', { threadId: '' })).status).toBe(400)
    })

    it("answers 404 for someone else's thread and leaves the pod alone", async () => {
      await seedServingPod({ threadId: 'thr-1', userId: 'usr-1' })

      expect((await post('session-b')).status).toBe(404)
      expect(resizableVercel.delete).not.toHaveBeenCalled()
      expect(await sandboxRows()).toHaveLength(1)
    })

    it('lets the owner destroy the pod: Vercel by name, then the row', async () => {
      await seedServingPod({ threadId: 'thr-1', userId: 'usr-1' })

      const reply = await post('session-a')

      expect(reply.status).toBe(200)
      expect(resizableVercel.delete).toHaveBeenCalledWith({
        threadId: 'thr-1',
        name: 'atlas-thread-thr-1',
      })
      expect(await sandboxRows()).toHaveLength(0)
    })

    it('answers 200 for a thread with no pod', async () => {
      expect((await post('session-a')).status).toBe(200)
      expect(resizableVercel.delete).not.toHaveBeenCalled()
    })
  })
})
