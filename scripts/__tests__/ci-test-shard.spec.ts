import { describe, expect, test } from 'bun:test'
import { runPooled, shardCommands } from '../ci-test-shard'

const packages = [
  { dir: '/r/packages/core', name: 'core', script: 'bun test', specs: 400 },
  { dir: '/r/apps/api', name: 'api', script: 'bun test --parallel --no-isolate', specs: 500 },
  { dir: '/r/apps/mac', name: 'mac', script: 'bun run bundle:payload && bun test', specs: 40 },
  { dir: '/r/evals', name: 'evals', script: 'bun --bun vitest run', specs: 1 },
]

describe('shardCommands', () => {
  test('every plain bun test script runs its own slice of files on each shard, largest first', () => {
    const commands = shardCommands({ packages, shard: 2, total: 4 })
    expect(commands).toEqual([
      { name: 'api', dir: '/r/apps/api', command: 'bun test --parallel --no-isolate --shard=2/4' },
      { name: 'core', dir: '/r/packages/core', command: 'bun test --shard=2/4' },
    ])
  })

  test('a script that is not a plain bun test runs whole, on the first shard only', () => {
    const first = shardCommands({ packages, shard: 1, total: 4 }).map((command) => command.command)
    expect(first).toContain('bun run bundle:payload && bun test')
    expect(first).toContain('bun --bun vitest run')
    const third = shardCommands({ packages, shard: 3, total: 4 }).map((command) => command.name)
    expect(third).toEqual(['api', 'core'])
  })
})

describe('runPooled', () => {
  test('never runs more than the limit at once and keeps each result at its index', async () => {
    let running = 0
    let peak = 0
    const codes = await runPooled({
      items: [3, 1, 2, 0, 4],
      limit: 2,
      run: async (item) => {
        running++
        peak = Math.max(peak, running)
        await Bun.sleep(item * 5)
        running--
        return item
      },
    })
    expect(peak).toBe(2)
    expect(codes).toEqual([3, 1, 2, 0, 4])
  })
})
