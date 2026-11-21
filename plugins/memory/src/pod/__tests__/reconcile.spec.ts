import { describe, expect, it } from 'bun:test'

import { fakeMemory, invoke, rig, textOf } from './support'

const DESCRIPTION = 'd'.repeat(180)

const fill = (args: { memory: ReturnType<typeof fakeMemory>; count: number; prefix: string }) => {
  for (let index = 0; index < args.count; index += 1) {
    const name = `${args.prefix}-${index}`
    args.memory.rows.set(`global:${name}`, {
      scope: 'global',
      name,
      description: DESCRIPTION,
      type: 'user',
      body: 'fact',
      revision: 1,
    })
  }
}

const write = (name: string, description = 'A short claim') => ({
  action: 'write',
  scope: 'global',
  name,
  description,
  type: 'user',
  body: 'fact\n\nWhy: x',
})

const forget = (name: string) => ({ action: 'delete', scope: 'global', name })

const setUp = () => {
  const memory = fakeMemory()
  const { ctx, log } = rig(memory.port)
  const run = async (input: unknown) => textOf(await invoke({ ctx, name: 'memory', input }))
  return { memory, ctx, log, run }
}

describe('the reconcile nudge', () => {
  it('stays quiet while the index is under the advisory limit', async () => {
    const { run, log } = setUp()
    expect(await run(write('one'))).toBe('Remembered one (global, revision 1).')
    expect(log).toEqual([])
  })

  it('fires once per crossing and records the latch in the session', async () => {
    const { memory, run, log } = setUp()
    fill({ memory, count: 70, prefix: 'a' })

    const first = await run(write('crossing'))
    expect(first).toContain('kind="memory-reconcile"')
    expect(first).toContain('advisory limit of 12000 characters')
    expect(first).toContain('- 2026-11-09 global a-0')
    expect(log.map((event) => event.type)).toEqual(['fact-recorded'])

    expect(await run(write('again'))).toBe('Remembered again (global, revision 1).')

    fill({ memory, count: 40, prefix: 'b' })
    const higher = await run(write('higher'))
    expect(higher).toContain('Reconcile the memory now')
    expect(await run(write('still'))).not.toContain('memory-reconcile')
  })

  it('re-arms only after the index drops below the advisory limit', async () => {
    const { memory, run, log } = setUp()
    fill({ memory, count: 70, prefix: 'a' })
    expect(await run(write('crossing'))).toContain('memory-reconcile')

    expect(await run(forget('a-0'))).toBe('Forgot a-0 (global).')
    expect(log).toHaveLength(1)

    for (let index = 1; index < 10; index += 1) await run(forget(`a-${index}`))
    expect(log.at(-1)).toMatchObject({
      type: 'fact-recorded',
      key: 'latch:memory-reconcile',
      value: 0,
    })

    fill({ memory, count: 10, prefix: 'c' })
    expect(await run(write('crossing-again'))).toContain('memory-reconcile')
  })

  it('refuses a description over the budget without writing', async () => {
    const { memory, run } = setUp()
    const reason = await run(write('long', 'd'.repeat(201)))
    expect(reason).toContain('The description has 201 characters. The limit is 200 characters')
    expect(memory.rows.size).toBe(0)
  })
})
