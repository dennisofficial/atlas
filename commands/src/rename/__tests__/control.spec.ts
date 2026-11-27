import { describe, expect, it } from 'bun:test'

import { renameHandlerOf, type SessionNameSuggester } from '../control'
import { REFUSAL_RENAME_NO_SUGGESTION } from '../spec'

const run = async (params: { args: unknown; suggestName?: SessionNameSuggester }) => {
  const calls: { sessionId: string; title: string }[] = []
  const asked: string[] = []
  const handler = renameHandlerOf({
    suggestName: async (ask) => {
      asked.push(ask.sessionId)
      return (await params.suggestName?.(ask)) ?? null
    },
  })
  const done = handler({
    plane: { renameSession: async (rename) => void calls.push(rename) },
    sessionId: 's1',
    args: params.args,
  })
  return { done, calls, asked }
}

describe('renameHandlerOf', () => {
  it('renames the session to the given name without asking for a suggestion', async () => {
    const { done, calls, asked } = await run({ args: { name: ' New name ' } })
    await done
    expect(calls).toEqual([{ sessionId: 's1', title: 'New name' }])
    expect(asked).toEqual([])
  })

  it('names the session from its transcript when no name is given', async () => {
    const { done, calls, asked } = await run({
      args: {},
      suggestName: async () => 'Sidebar Port',
    })
    await done
    expect(asked).toEqual(['s1'])
    expect(calls).toEqual([{ sessionId: 's1', title: 'Sidebar Port' }])
  })

  it('refuses with its own sentence when no name can be suggested', async () => {
    const { done, calls } = await run({ args: {} })
    expect(done).rejects.toThrow(REFUSAL_RENAME_NO_SUGGESTION)
    await done.catch(() => undefined)
    expect(calls).toEqual([])
  })

  it('rejects invalid arguments without touching the plane', async () => {
    const { done, calls, asked } = await run({ args: { name: '' } })
    expect(done).rejects.toThrow()
    await done.catch(() => undefined)
    expect(calls).toEqual([])
    expect(asked).toEqual([])
  })
})
