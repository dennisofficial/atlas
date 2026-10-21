import { EAccountOrigin, EAccountStatus, EAuthKind, EAuthProvider } from '@dltech/atlas-core'

export const OPENROUTER_KEY = 'sk-or-fake'
export const OPENROUTER_LEASE = {
  accounts: [
    {
      id: 'acc_openrouter_lease',
      provider: EAuthProvider.OpenRouter,
      kind: EAuthKind.ApiKey,
      origin: EAccountOrigin.Login,
      label: 'OpenRouter',
      status: EAccountStatus.Active,
      createdAt: '2026-10-20T00:00:00.000Z',
      updatedAt: '2026-10-20T00:00:00.000Z',
      secret: { kind: EAuthKind.ApiKey, apiKey: OPENROUTER_KEY },
    },
  ],
  active: [{ provider: EAuthProvider.OpenRouter, accountId: 'acc_openrouter_lease' }],
}

export const MODEL_ID = 'openai/gpt-4o-mini'

export const WRITE_TRIGGER = 'write the marker'
export const READ_TRIGGER = 'read the marker'

export type RecordedRequest = { body: ChatBody }

type ChatMessage = { role: string; content?: unknown }
type ChatBody = { stream?: boolean; tools?: { function?: { name?: string } }[]; messages: ChatMessage[] }

export type FakeModel = {
  url: string
  requests: ChatBody[]
  authorizations: (string | null)[]
  stop: () => Promise<void>
}

const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part: unknown) => (typeof part === 'object' && part !== null && 'text' in part ? String(part.text) : ''))
    .join('')
}

const saidSinceLastAnswer = ({ messages }: { messages: ChatMessage[] }): string => {
  const answered = messages.findLastIndex((message) => message.role !== 'user')
  return messages
    .slice(answered + 1)
    .map((message) => textOf(message.content))
    .join('\n')
}

type Reply = { text: string } | { command: string; description: string }

const replyFor = ({ body, marker }: { body: ChatBody; marker: string }): Reply => {
  const last = body.messages.at(-1)
  if (last?.role === 'tool') return { text: 'done' }
  const offersBash = body.tools?.some((tool) => tool.function?.name === 'bash') === true
  if (!offersBash || last?.role !== 'user') return { text: 'ok' }
  const said = saidSinceLastAnswer({ messages: body.messages })
  if (said.includes(WRITE_TRIGGER)) {
    return { command: `printf '%s' '${marker}' > pod-marker.txt && pwd`, description: 'write the marker' }
  }
  if (said.includes(READ_TRIGGER)) return { command: 'cat pod-marker.txt', description: 'read the marker' }
  return { text: 'ok' }
}

const chunk = (delta: object, finish: string | null) => ({
  id: 'fake',
  object: 'chat.completion.chunk',
  created: 1,
  model: MODEL_ID,
  choices: [{ index: 0, delta, finish_reason: finish }],
  ...(finish === null ? {} : { usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
})

const streamOf = (reply: Reply): Response => {
  const frames =
    'text' in reply
      ? [chunk({ role: 'assistant', content: reply.text }, null), chunk({}, 'stop')]
      : [
          chunk(
            {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: `call_${crypto.randomUUID().slice(0, 8)}`,
                  type: 'function',
                  function: {
                    name: 'bash',
                    arguments: JSON.stringify({ command: reply.command, description: reply.description }),
                  },
                },
              ],
            },
            null,
          ),
          chunk({}, 'tool_calls'),
        ]
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

export const startFakeModel = ({ marker }: { marker: string }): FakeModel => {
  const requests: ChatBody[] = []
  const authorizations: (string | null)[] = []
  const server = Bun.serve({
    port: 0,
    hostname: '0.0.0.0',
    fetch: async (request) => {
      if (new URL(request.url).pathname !== '/v1/chat/completions') return new Response('not found', { status: 404 })
      const body = (await request.json()) as ChatBody
      requests.push(body)
      authorizations.push(request.headers.get('authorization'))
      const reply = replyFor({ body, marker })
      return body.stream === true ? streamOf(reply) : completionOf(reply)
    },
  })
  return {
    url: `http://host.docker.internal:${server.port}/v1`,
    requests,
    authorizations,
    stop: async () => {
      await server.stop(true)
    },
  }
}

export const dockerCli = async ({ socket, args }: { socket: string; args: readonly string[] }): Promise<string> => {
  const child = Bun.spawn(['docker', ...args], {
    env: { ...process.env, DOCKER_HOST: `unix://${socket}` },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (code !== 0) throw new Error(`docker ${args.join(' ')} exited ${code}: ${stderr}`)
  return stdout
}
