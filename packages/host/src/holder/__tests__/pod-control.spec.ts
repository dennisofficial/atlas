import { describe, expect, it, vi } from 'bun:test'
import {
  EToolEffect,
  toThreadId,
  ToolDefinition,
  type ToolInvocation,
  type ToolOutcome,
} from '@dltech/atlas-core'
import {
  composePlugins,
  definePlugin,
  EMPTY_CONTROL,
  EMPTY_POD,
  type PluginPodContext,
} from '@dltech/atlas-plugin-sdk'
import { z } from 'zod'
import { podControlOf, type PodControlClient } from '../pod-control'
import { makeRig, seedSession, THREAD, THREAD_ID } from './holder-rig'

const portArgs = z.strictObject({ port: z.number().int().min(1).max(65_535) })

class ExposePortProbe extends ToolDefinition {
  readonly name = 'expose_port_probe'
  readonly description = 'expose a port through the control plane'
  readonly effect = EToolEffect.Write
  readonly inputSchema = portArgs

  constructor(private readonly ctx: PluginPodContext) {
    super()
  }

  async invoke(args: ToolInvocation): Promise<ToolOutcome> {
    const { port } = portArgs.parse(args.input)
    const reply = await this.ctx.control.exposePort({ port })
    return { ok: true, output: reply.url, modelText: reply.url }
  }
}

const toolResultsOf = async (
  rig: Awaited<ReturnType<typeof makeRig>>,
): Promise<
  Awaited<ReturnType<typeof rig.plane.readEvents>>['events'] extends readonly (infer T)[]
    ? readonly Extract<T, { type: 'tool-result' }>[]
    : never
> => {
  const page = await rig.plane.readEvents({
    threadId: THREAD_ID,
    afterSeq: 0,
    limit: 500,
    visible: false,
  })
  return page.events.flatMap((event) => (event.type === 'tool-result' ? [event] : []))
}

const probePlugin = definePlugin({
  name: 'expose-probe',
  events: [],
  views: [],
  commands: [],
  pod: { ...EMPTY_POD, tools: (ctx) => [new ExposePortProbe(ctx)] },
  control: EMPTY_CONTROL,
  client: { hooks: [] },
  transport: 'none',
})

const memoryStub: PodControlClient['memory'] = {
  list: async () => ({ project: null, memories: [] }),
  read: async () => null,
  write: async () => {
    throw new Error('this test writes no memory')
  },
  edit: async () => {
    throw new Error('this test edits no memory')
  },
  remove: async () => false,
}

const recordingClient = (): PodControlClient & { calls: { threadId: string; port: number }[] } => {
  const calls: { threadId: string; port: number }[] = []
  return {
    calls,
    exposePort: async (args) => {
      calls.push({ threadId: args.threadId, port: args.port })
      return { url: `https://${args.port}-abc.byatlas.dev`, tunnelToken: 'tunnel-token' }
    },
    memory: memoryStub,
  }
}

describe('podControlOf', () => {
  it('calls the client for the holder thread, not a thread of the caller naming', async () => {
    const client = recordingClient()
    const control = podControlOf({ client, threadId: THREAD_ID })
    const reply = await control.exposePort({ port: 4317 })
    expect(reply).toEqual({ url: 'https://4317-abc.byatlas.dev', tunnelToken: 'tunnel-token' })
    expect(client.calls).toEqual([{ threadId: THREAD, port: 4317 }])
  })

  it('rejects with the documented message when the session has no client', async () => {
    const control = podControlOf({ client: undefined, threadId: THREAD_ID })
    await expect(control.exposePort({ port: 4317 })).rejects.toThrow(
      'this session cannot reach the control plane',
    )
  })

  it('wraps a client rejection with the port', async () => {
    const control = podControlOf({
      client: {
        memory: memoryStub,
        exposePort: async () => {
          throw new Error('the control plane said no')
        },
      },
      threadId: THREAD_ID,
    })
    await expect(control.exposePort({ port: 4317 })).rejects.toThrow(
      'could not expose port 4317: the control plane said no',
    )
  })
})

describe('a plugin tool reaching ctx.control', () => {
  it('gets the client answer for its own thread', async () => {
    const client = recordingClient()
    const rig = await makeRig({
      script: [
        { calls: [{ callId: 'c1', name: 'expose_port_probe', input: { port: 4317 } }] },
        { text: 'done' },
      ],
      plugins: composePlugins([probePlugin]),
      control: client,
    })
    await seedSession(rig)
    await rig.holder.start()
    await rig.post('expose it')
    await rig.flush()
    expect(client.calls).toEqual([{ threadId: THREAD, port: 4317 }])
    const results = await toolResultsOf(rig)
    expect(results).toHaveLength(1)
    expect(results[0]?.output).toBe('https://4317-abc.byatlas.dev')
  })

  it('fails the tool rather than the session when the control plane answers with an error', async () => {
    const rig = await makeRig({
      script: [
        { calls: [{ callId: 'c1', name: 'expose_port_probe', input: { port: 4317 } }] },
        { text: 'done' },
      ],
      plugins: composePlugins([probePlugin]),
      control: {
        memory: memoryStub,
        exposePort: async () => {
          throw new Error('the control plane rejected the call (500): boom')
        },
      },
    })
    await seedSession(rig)
    await rig.holder.start()
    await rig.post('expose it')
    await rig.flush()
    const results = await toolResultsOf(rig)
    expect(results).toHaveLength(1)
    expect(results[0]?.error?.message).toContain('could not expose port 4317')
  })
})

describe('podControlOf wiring', () => {
  it('does not read a thread id from the tool input', async () => {
    const client = {
      memory: memoryStub,
      exposePort: vi.fn(async () => ({ url: 'u', tunnelToken: 't' })),
    }
    const control = podControlOf({ client, threadId: toThreadId('thr_holder') })
    await control.exposePort({ port: 1 })
    expect(client.exposePort).toHaveBeenCalledWith({ threadId: 'thr_holder', port: 1 })
  })
})
