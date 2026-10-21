import { MODEL_ID, OPENROUTER_LEASE } from './pod-session-live-fixture'

export const REMEMBER_TRIGGER = 'remember the pod fact'

type ChatMessage = { role: string; content?: unknown }
type ChatBody = { stream?: boolean; tools?: { function?: { name?: string } }[]; messages: ChatMessage[] }

type Reply = { text: string } | { tool: string; input: object }

export type StoredMemory = {
  scope: string
  project: string | null
  name: string
  description: string
  type: string
  body: string
  revision: number
  updatedAt: string
}

export const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part: unknown) => (typeof part === 'object' && part !== null && 'text' in part ? String(part.text) : ''))
    .join('')
}

const chunk = (delta: object, finish: string | null) => ({
  id: 'fake',
  object: 'chat.completion.chunk',
  created: 1,
  model: MODEL_ID,
  choices: [{ index: 0, delta, finish_reason: finish }],
  ...(finish === null ? {} : { usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
})

const toolCallFrame = (reply: { tool: string; input: object }) =>
  chunk(
    {
      role: 'assistant',
      tool_calls: [
        {
          index: 0,
          id: `call_${crypto.randomUUID().slice(0, 8)}`,
          type: 'function',
          function: { name: reply.tool, arguments: JSON.stringify(reply.input) },
        },
      ],
    },
    null,
  )

const streamOf = (reply: Reply): Response => {
  const frames =
    'text' in reply
      ? [chunk({ role: 'assistant', content: reply.text }, null), chunk({}, 'stop')]
      : [toolCallFrame(reply), chunk({}, 'tool_calls')]
  const body = [...frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`), 'data: [DONE]\n\n'].join('')
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
}

const completionOf = (reply: Reply): Response =>
  Response.json({
    id: 'fake',
    object: 'chat.completion',
    created: 1,
    model: MODEL_ID,
    choices: [
      { index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'text' in reply ? reply.text : 'ok' } },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  })

const saidSinceLastAnswer = (messages: ChatMessage[]): string => {
  const answered = messages.findLastIndex((message) => message.role !== 'user')
  return messages
    .slice(answered + 1)
    .map((message) => textOf(message.content))
    .join('\n')
}

const replyFor = ({ body, memoryName }: { body: ChatBody; memoryName: string }): Reply => {
  const last = body.messages.at(-1)
  if (last?.role === 'tool') return { text: 'done' }
  const offersMemory = body.tools?.some((tool) => tool.function?.name === 'write_memory') === true
  if (!offersMemory || last?.role !== 'user' || !saidSinceLastAnswer(body.messages).includes(REMEMBER_TRIGGER)) {
    return { text: 'ok' }
  }
  return {
    tool: 'write_memory',
    input: {
      scope: 'global',
      name: memoryName,
      description: 'a fact written from inside a local pod',
      type: 'reference',
      body: 'Pods write memory through the Atlas Cloud API.',
    },
  }
}

export type FakeMemoryModel = { url: string; requests: ChatBody[]; stop: () => Promise<void> }

export const startMemoryModel = ({ memoryName }: { memoryName: string }): FakeMemoryModel => {
  const requests: ChatBody[] = []
  const server = Bun.serve({
    port: 0,
    hostname: '0.0.0.0',
    fetch: async (request) => {
      if (new URL(request.url).pathname !== '/v1/chat/completions') return new Response('not found', { status: 404 })
      const body = (await request.json()) as ChatBody
      requests.push(body)
      const reply = replyFor({ body, memoryName })
      return body.stream === true ? streamOf(reply) : completionOf(reply)
    },
  })
  return {
    url: `http://host.docker.internal:${server.port}/v1`,
    requests,
    stop: async () => {
      await server.stop(true)
    },
  }
}

const summaryOf = ({ body: _body, ...summary }: StoredMemory) => summary

type WriteBody = Omit<StoredMemory, 'revision' | 'updatedAt' | 'project'> & { project?: string }

export type FakeMemoryApi = {
  hostUrl: string
  podUrl: string
  memories: Map<string, StoredMemory>
  bearers: Set<string>
  stop: () => Promise<void>
}

const keyOf = (args: { scope: string; project: string | null; name: string }): string =>
  `${args.scope}:${args.project ?? ''}:${args.name}`

export const startFakeMemoryApi = (): FakeMemoryApi => {
  const memories = new Map<string, StoredMemory>()
  const bearers = new Set<string>()
  const server = Bun.serve({
    port: 0,
    hostname: '0.0.0.0',
    fetch: async (request) => {
      const url = new URL(request.url)
      if (url.pathname.startsWith('/v1/pod-leases/')) return new Response(null, { status: 204 })
      if (url.pathname === '/v1/account-lease') return Response.json(OPENROUTER_LEASE)
      if (url.pathname === '/v1/settings') return Response.json({ settings: [] })
      if (url.pathname === '/v1/secrets') return Response.json({ secrets: [] })
      const bearer = request.headers.get('authorization')
      if (bearer !== null) bearers.add(bearer)
      if (url.pathname === '/v1/memories' && request.method === 'GET') {
        return Response.json({ memories: [...memories.values()].map(summaryOf) })
      }
      if (url.pathname === '/v1/memories/entry' && request.method === 'PUT') {
        const body = (await request.json()) as WriteBody
        const project = body.project ?? null
        const held = memories.get(keyOf({ ...body, project }))
        const stored: StoredMemory = {
          ...body,
          project,
          revision: (held?.revision ?? 0) + 1,
          updatedAt: new Date().toISOString(),
        }
        memories.set(keyOf(stored), stored)
        return Response.json(summaryOf(stored))
      }
      return new Response('not found', { status: 404 })
    },
  })
  return {
    hostUrl: `http://127.0.0.1:${server.port}`,
    podUrl: `http://host.docker.internal:${server.port}`,
    memories,
    bearers,
    stop: async () => {
      await server.stop(true)
    },
  }
}
