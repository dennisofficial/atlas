import { describe, expect, test } from 'bun:test'
import { shardCommands } from '../ci-test-shard'

const packages = [
  { dir: '/r/apps/api', name: 'api', script: 'bun test --parallel --no-isolate' },
  { dir: '/r/packages/core', name: 'core', script: 'bun test' },
  { dir: '/r/apps/mac', name: 'mac', script: 'bun run bundle:payload && bun test' },
  { dir: '/r/evals', name: 'evals', script: 'bun --bun vitest run' },
]

describe('shardCommands', () => {
  test('every plain bun test script runs its own slice of files on each shard', () => {
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
