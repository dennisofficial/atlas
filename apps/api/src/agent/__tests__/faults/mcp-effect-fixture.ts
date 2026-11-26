import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

export const FIXTURE_TOOL = 'count'

export const FIXTURE_ANSWER = 'counted'

const PROTOCOL_VERSION = '2025-06-18'

const SERVER_NAME = 'fixture'

const TOOLS = [
  {
    name: FIXTURE_TOOL,
    description: 'count one server-side effect',
    inputSchema: { type: 'object' },
  },
]

type Effect = { runs: string; started: string; gate: string }

type Request = { id?: unknown; method?: unknown }

const effectOf = (argv: readonly string[]): Effect => {
  const [runs, started, gate] = argv
  if (runs === undefined || started === undefined || gate === undefined) {
    throw new Error('the fixture needs the runs, started and gate paths as arguments')
  }
  return { runs, started, gate }
}

const countOf = (effect: Effect): unknown => {
  appendFileSync(effect.runs, 'run\n')
  writeFileSync(effect.started, '')
  readFileSync(effect.gate)
  return { content: [{ type: 'text', text: FIXTURE_ANSWER }] }
}

const resultOf = (request: Request, effect: Effect): unknown => {
  if (request.method === 'initialize') {
    return {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: SERVER_NAME, version: '1' },
    }
  }
  if (request.method === 'tools/list') return { tools: TOOLS }
  if (request.method === 'tools/call') return countOf(effect)
  return {}
}

const serve = (): void => {
  const effect = effectOf(process.argv.slice(2))
  const lines = createInterface({ input: process.stdin })
  lines.on('line', (line) => {
    const request = JSON.parse(line) as Request
    if (request.id === undefined || request.id === null) return
    const message = { jsonrpc: '2.0', id: request.id, result: resultOf(request, effect) }
    process.stdout.write(`${JSON.stringify(message)}\n`)
  })
}

if (import.meta.main) serve()
