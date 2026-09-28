import { describe, expect, it } from 'bun:test'

import { runRelocation, type RelocationPlan } from '../dag'

type Trace = { started: string[]; finished: string[] }

const trace = (): Trace => ({ started: [], finished: [] })

const node = (args: { id: string; needs?: readonly string[]; run: () => Promise<void> }) => ({
  id: args.id,
  needs: args.needs ?? [],
  run: args.run,
})

const tracedNode = (args: { trace: Trace; id: string; needs?: readonly string[] }) =>
  node({
    id: args.id,
    needs: args.needs ?? [],
    run: async () => {
      args.trace.started.push(args.id)
      args.trace.finished.push(args.id)
    },
  })

const deferred = () => {
  let release = () => {}
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

describe('runRelocation', () => {
  it('runs a dependency chain in order and reports ok', async () => {
    const t = trace()
    const plan: RelocationPlan<Trace> = [
      tracedNode({ trace: t, id: 'a' }),
      tracedNode({ trace: t, id: 'b', needs: ['a'] }),
      tracedNode({ trace: t, id: 'c', needs: ['b'] }),
    ]

    const result = await runRelocation({ plan, ctx: t })

    expect(result).toEqual({ ok: true })
    expect(t.finished).toEqual(['a', 'b', 'c'])
  })

  it('overlaps independent nodes instead of serializing them', async () => {
    const t = trace()
    const gateA = deferred()
    const gateB = deferred()
    const plan: RelocationPlan<Trace> = [
      node({
        id: 'a',
        run: async () => {
          t.started.push('a')
          await gateA.promise
          t.finished.push('a')
        },
      }),
      node({
        id: 'b',
        run: async () => {
          t.started.push('b')
          await gateB.promise
          t.finished.push('b')
        },
      }),
    ]

    const running = runRelocation({ plan, ctx: t })
    await Promise.resolve()

    expect(t.started).toContain('a')
    expect(t.started).toContain('b')
    expect(t.finished).toEqual([])

    gateB.release()
    await Promise.resolve()
    gateA.release()

    const result = await running
    expect(result).toEqual({ ok: true })
    expect(t.finished).toEqual(['b', 'a'])
  })

  it('holds the commit node until every node in its transitive ancestry finishes', async () => {
    const t = trace()
    const slow = deferred()
    const plan: RelocationPlan<Trace> = [
      node({
        id: 'slow',
        run: async () => {
          await slow.promise
          t.finished.push('slow')
        },
      }),
      tracedNode({ trace: t, id: 'gate', needs: ['slow'] }),
      { id: 'commit', needs: ['gate'], commit: true, run: async () => {} },
      tracedNode({ trace: t, id: 'after', needs: ['commit'] }),
    ]
    const steps: string[] = []

    const running = runRelocation({ plan, ctx: t, onStep: (id) => steps.push(id) })
    await Promise.resolve()
    await Promise.resolve()

    expect(steps).toContain('slow')
    expect(steps).not.toContain('commit')
    expect(steps).not.toContain('after')

    slow.release()
    const result = await running

    expect(result).toEqual({ ok: true })
    expect(t.finished.indexOf('slow')).toBeLessThan(t.finished.indexOf('gate'))
    expect(steps.indexOf('commit')).toBeGreaterThan(steps.indexOf('gate'))
    expect(steps.indexOf('after')).toBeGreaterThan(steps.indexOf('commit'))
  })

  it('holds a need-less commit node behind every pre-commit node', async () => {
    const t = trace()
    const slow = deferred()
    const plan: RelocationPlan<Trace> = [
      node({
        id: 'slow',
        run: async () => {
          await slow.promise
          t.finished.push('slow')
        },
      }),
      { id: 'commit', needs: [], commit: true, run: async () => {} },
      tracedNode({ trace: t, id: 'after', needs: ['commit'] }),
    ]
    const steps: string[] = []

    const running = runRelocation({ plan, ctx: t, onStep: (id) => steps.push(id) })
    await Promise.resolve()
    await Promise.resolve()

    expect(steps).toContain('slow')
    expect(steps).not.toContain('commit')

    slow.release()
    const result = await running

    expect(result).toEqual({ ok: true })
    expect(steps.indexOf('commit')).toBeGreaterThan(steps.indexOf('slow'))
    expect(steps.indexOf('after')).toBeGreaterThan(steps.indexOf('commit'))
  })

  it('holds the commit node behind pre-commit work without deadlocking on a transitive post-commit node', async () => {
    const t = trace()
    const plan: RelocationPlan<Trace> = [
      tracedNode({ trace: t, id: 'pre' }),
      { id: 'commit', needs: ['pre'], commit: true, run: async () => {} },
      tracedNode({ trace: t, id: 'after', needs: ['commit'] }),
      tracedNode({ trace: t, id: 'afterAfter', needs: ['after'] }),
    ]

    const result = await runRelocation({ plan, ctx: t })

    expect(result).toEqual({ ok: true })
    expect(t.finished).toEqual(['pre', 'after', 'afterAfter'])
  })

  it('reports a failure before the commit node as pre-commit and runs nothing more', async () => {
    const t = trace()
    const cause = new Error('archive exploded')
    const plan: RelocationPlan<Trace> = [
      node({
        id: 'broken',
        run: async () => {
          throw cause
        },
      }),
      tracedNode({ trace: t, id: 'gate', needs: ['broken'] }),
      { id: 'commit', needs: ['gate'], commit: true, run: async () => {} },
      tracedNode({ trace: t, id: 'after', needs: ['commit'] }),
    ]
    const steps: string[] = []

    const result = await runRelocation({ plan, ctx: t, onStep: (id) => steps.push(id) })

    expect(result).toEqual({ ok: false, phase: 'pre-commit', failed: 'broken', error: cause })
    expect(steps).toEqual(['broken'])
  })

  it('reports a throw inside the commit node itself as pre-commit', async () => {
    const cause = new Error('flip failed before writing')
    const t = trace()
    const plan: RelocationPlan<Trace> = [
      tracedNode({ trace: t, id: 'gate' }),
      {
        id: 'commit',
        needs: ['gate'],
        commit: true,
        run: async () => {
          throw cause
        },
      },
    ]

    const result = await runRelocation({ plan, ctx: t })

    expect(result).toEqual({ ok: false, phase: 'pre-commit', failed: 'commit', error: cause })
  })

  it('reports a failure after the commit node completed as committed', async () => {
    const cause = new Error('attach failed')
    const t = trace()
    const plan: RelocationPlan<Trace> = [
      tracedNode({ trace: t, id: 'gate' }),
      { id: 'commit', needs: ['gate'], commit: true, run: async () => {} },
      node({
        id: 'after',
        needs: ['commit'],
        run: async () => {
          throw cause
        },
      }),
    ]

    const result = await runRelocation({ plan, ctx: t })

    expect(result).toEqual({ ok: false, phase: 'committed', failed: 'after', error: cause })
  })

  it('throws on a needs entry naming an unknown node, before any effect runs', async () => {
    const t = trace()
    const plan: RelocationPlan<Trace> = [tracedNode({ trace: t, id: 'a', needs: ['ghost'] })]

    await expect(runRelocation({ plan, ctx: t })).rejects.toThrow(/ghost/)
    expect(t.started).toEqual([])
  })

  it('throws on a dependency cycle, before any effect runs', async () => {
    const t = trace()
    const plan: RelocationPlan<Trace> = [
      tracedNode({ trace: t, id: 'a', needs: ['b'] }),
      tracedNode({ trace: t, id: 'b', needs: ['c'] }),
      tracedNode({ trace: t, id: 'c', needs: ['a'] }),
    ]

    await expect(runRelocation({ plan, ctx: t })).rejects.toThrow(/cycle/)
    expect(t.started).toEqual([])
  })
})
