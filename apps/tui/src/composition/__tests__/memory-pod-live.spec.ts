import { describe, expect, it } from 'bun:test'

import { EEffort, ERunner, toThreadId, type ThreadId } from '@dltech/atlas-core'
import {
  createPodRunner,
  birthInCloud,
  createLocalPodBridge,
  DEFAULT_DOCKER_SOCKET,
  ERuntimeKind,
  ETurnStatus,
  pingDocker,
  type CloudAttachment,
} from '@dltech/atlas-harness'

import { livePodBridgeOptionsFor } from '../live-pod'
import { fakeApp, fakeCloud, scriptedModelPort } from './fake-app'
import { fakeSessionRuntime } from './fake-session-runtime'
import {
  REMEMBER_TRIGGER,
  startFakeMemoryApi,
  startMemoryModel,
  textOf,
} from './memory-pod-live-fixture'
import { MODEL_ID } from './pod-session-live-fixture'

const SOCKET = process.env.ATLAS_DOCKER_SOCKET ?? DEFAULT_DOCKER_SOCKET
const enabled =
  process.env.ATLAS_LIVE_DOCKER === '1' && (await pingDocker({ socketPath: SOCKET })) === undefined
const describeLive = enabled ? describe : describe.skip

const WRITER = toThreadId(`brn_tui_memory_writer_${process.pid}`)
const READER = toThreadId(`brn_tui_memory_reader_${process.pid}`)
const MEMORY_NAME = `pod-memory-${crypto.randomUUID().slice(0, 8)}`
const LIVE_TIMEOUT_MS = 20 * 60_000

describeLive('memory written in one pod', () => {
  it(
    "is listed in the next session's system prompt index",
    async () => {
      const fakeModel = startMemoryModel({ memoryName: MEMORY_NAME })
      const memoryApi = startFakeMemoryApi()
      const app = fakeApp({
        model: scriptedModelPort({ script: { thinking: '', reply: 'ok' } }),
        cloud: fakeCloud({
          session: { url: memoryApi.hostUrl, token: 'live-session', email: null },
        }),
      })
      const options = livePodBridgeOptionsFor(app)
      const bridge = createLocalPodBridge({
        ...options,
        pod: () => ({ ...options.pod(), cloudUrl: memoryApi.podUrl }),
        environment: () => ({ OPENROUTER_BASE_URL: fakeModel.url }),
      })

      const born = async (threadId: ThreadId) => {
        const attachments: CloudAttachment[] = []
        await app.sessionOwner.placement.activate({ threadId })
        const birth = await birthInCloud({
          threadId,
          projectId: null,
          runner: ERunner.Local,
          identity: app.workspace,
          model: { ref: `openrouter/${MODEL_ID}`, effort: EEffort.Medium },
          bridge,
          localThreads: app.threads,
          ids: app.ids,
          placement: app.sessionOwner,
          open: async ({ attachment, prepareRuntime }) => {
            attachments.push(attachment)
            prepareRuntime({
              kind: ERuntimeKind.Cloud,
              cwd: '/atlas/workspaces',
              adapters: fakeSessionRuntime(app),
            })
          },
        })
        if (!birth.ok) throw new Error(`birth of ${threadId} failed: ${birth.detail}`)
        const attachment = attachments[0]
        if (attachment === undefined)
          throw new Error(`birth of ${threadId} never opened an attachment`)
        return createPodRunner({ bridge, channel: attachment.channel, threadId, projectId: null })
      }

      try {
        const writer = await born(WRITER)
        const wrote = await writer.say({ threadId: WRITER, text: REMEMBER_TRIGGER })
        expect(wrote.status).toBe(ETurnStatus.Completed)
        expect([...memoryApi.memories.values()].map((memory) => memory.name)).toContain(MEMORY_NAME)
        expect(memoryApi.bearers.size).toBeGreaterThan(0)
        expect(memoryApi.bearers.has('Bearer live-session')).toBe(false)

        const seen = fakeModel.requests.length
        const reader = await born(READER)
        const read = await reader.say({ threadId: READER, text: 'hello' })
        expect(read.status).toBe(ETurnStatus.Completed)

        const mainRequests = fakeModel.requests
          .slice(seen)
          .filter(
            (request) =>
              request.tools?.some((tool) => tool.function?.name === 'write_memory') === true,
          )
        const firstSystem = mainRequests[0]?.messages
          .filter((message) => message.role === 'system')
          .map((message) => textOf(message.content))
          .join('\n')
        expect(firstSystem).toContain(`- ${MEMORY_NAME} — a fact written from inside a local pod`)
      } finally {
        await bridge.sandboxes.destroy({ threadId: WRITER })
        await bridge.sandboxes.destroy({ threadId: READER })
        await fakeModel.stop()
        await memoryApi.stop()
      }
    },
    LIVE_TIMEOUT_MS,
  )
})
