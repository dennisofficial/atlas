import { EDiagramRepair } from '@dltech/atlas-core'
import { ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, describe, expect, it, spyOn } from 'bun:test'

import { cipher, seedApiKeyAccount, seedOwner } from '../../config/__tests__/config-reader.fixture'
import { diagramRepairerOf } from '../diagram-repairer'

const testDb = useTestDatabase()

const answerWith = (text: string): string =>
  JSON.stringify({
    id: 'm1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-4-1',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 3, output_tokens: 4 },
  })

type SeenCall = { url: string; body: string }

const recordFetch = (reply: string): SeenCall[] => {
  const seen: SeenCall[] = []
  const stub = async (input: URL | string, init?: RequestInit): Promise<Response> => {
    seen.push({ url: String(input), body: typeof init?.body === 'string' ? init.body : '' })
    return new Response(reply, { headers: { 'content-type': 'application/json' } })
  }
  spyOn(globalThis, 'fetch').mockImplementation(stub as unknown as typeof fetch)
  return seen
}

afterEach(() => {
  const spied = globalThis.fetch as unknown as { mockRestore?: () => void }
  spied.mockRestore?.()
})

const seedSessionModel = async (args: { modelRef: string; withAccount?: boolean }) => {
  const { db } = testDb()
  await seedOwner(db)
  if (args.withAccount !== false) await seedApiKeyAccount(db)
  await new ControlPlane({ store: new PostgresControlStore(db) }).createSession({
    sessionId: 's-opus',
    userId: 'user-1',
    projectId: 'proj-1',
    mainThreadId: 't-opus',
    model: { ref: args.modelRef, effort: 'high', fast: false },
  })
  return { db, sessionId: 's-opus' }
}

const SOURCE = 'graph TD\n  A[one; two] --> B[done]'
const ERROR = 'Parse error on line 2'

describe('diagramRepairerOf', () => {
  it('asks the session main model and names it in the result', async () => {
    const { db, sessionId } = await seedSessionModel({
      modelRef: 'anthropic/claude-opus-4-1',
    })
    const seen = recordFetch(answerWith('graph TD\n  A["one; two"] --> B[done]'))
    const repair = diagramRepairerOf({ db, cipher })

    const result = await repair({ sessionId, source: SOURCE, error: ERROR })

    expect(result.modelRef).toBe('anthropic/claude-opus-4-1')
    expect(result.outcome).toEqual({
      kind: EDiagramRepair.Repaired,
      repaired: 'graph TD\n  A["one; two"] --> B[done]',
    })
    expect(seen).toHaveLength(1)
    expect(seen[0]?.url).toContain('api.anthropic.com')
    expect(JSON.parse(seen[0]?.body ?? '{}').model).toBe('claude-opus-4-1')
  })

  it('raises when no account can serve the session model', async () => {
    const { db, sessionId } = await seedSessionModel({
      modelRef: 'anthropic/claude-opus-4-1',
      withAccount: false,
    })
    recordFetch(answerWith('unused'))

    const repair = diagramRepairerOf({ db, cipher })

    expect(repair({ sessionId, source: SOURCE, error: ERROR })).rejects.toThrow()
  })
})
