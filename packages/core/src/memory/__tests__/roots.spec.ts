import { describe, expect, it } from 'bun:test'

import { EDefinitionOrigin } from '../../discovery/origin'
import {
  isMemoryFile,
  memoryIndexIn,
  memoryRootPlan,
  sanitiseRepoIdentity,
  sanitiseRepoPath,
} from '../roots'

describe('memoryRootPlan', () => {
  const plan = memoryRootPlan({ atlasHome: '/home/dev/.atlas', repoRoot: '/home/dev/code/atlas' })

  it('offers the user directory before the project one', () => {
    expect(plan.map((root) => root.origin)).toEqual([
      EDefinitionOrigin.User,
      EDefinitionOrigin.Project,
    ])
  })

  it('puts global memory directly under the atlas home', () => {
    expect(plan[0]?.directory).toBe('/home/dev/.atlas/memory')
  })

  it('keys project memory on the sanitised repository path', () => {
    expect(plan[1]?.directory).toBe('/home/dev/.atlas/projects/-home-dev-code-atlas/memory')
  })

  it('tolerates a trailing separator on the atlas home', () => {
    const trailing = memoryRootPlan({ atlasHome: '/home/dev/.atlas/', repoRoot: '/a' })
    expect(trailing[0]?.directory).toBe('/home/dev/.atlas/memory')
  })

  it('keys project memory on the repo identity when one is known', () => {
    const keyed = memoryRootPlan({
      atlasHome: '/home/dev/.atlas',
      repoRoot: '/home/dev/code/atlas',
      identity: 'github.com/dennisofficial/atlas',
    })
    expect(keyed[1]?.directory).toBe(
      '/home/dev/.atlas/projects/github.com/dennisofficial/atlas/memory',
    )
  })

  it('gives two checkouts of one repo the same identity-keyed directory', () => {
    const fromRepo = memoryRootPlan({
      atlasHome: '/h',
      repoRoot: '/code/atlas',
      identity: 'github.com/org/atlas',
    })
    const fromWorktree = memoryRootPlan({
      atlasHome: '/h',
      repoRoot: '/code/atlas/.atlas/worktrees/fix',
      identity: 'github.com/org/atlas',
    })
    expect(fromWorktree[1]?.directory).toBe(fromRepo[1]?.directory)
  })

  it('resolves the index inside a directory', () => {
    expect(memoryIndexIn('/home/dev/.atlas/memory')).toBe('/home/dev/.atlas/memory/MEMORY.md')
  })
})

describe('sanitiseRepoPath', () => {
  it('flattens every non-alphanumeric character', () => {
    expect(sanitiseRepoPath('/Users/dev/Developer/atlas')).toBe('-Users-dev-Developer-atlas')
  })

  it('keeps two repositories that differ past the length cap apart', () => {
    const long = `/${'a'.repeat(400)}`
    const other = `/${'a'.repeat(400)}b`
    expect(sanitiseRepoPath(long)).not.toBe(sanitiseRepoPath(other))
    expect(sanitiseRepoPath(long).length).toBeLessThan(220)
  })

  it('is stable for the same input', () => {
    const path = `/${'z'.repeat(500)}`
    expect(sanitiseRepoPath(path)).toBe(sanitiseRepoPath(path))
  })
})

describe('sanitiseRepoIdentity', () => {
  it('keeps the host hierarchy and filename-safe characters', () => {
    expect(sanitiseRepoIdentity('github.com/org/repo')).toBe('github.com/org/repo')
  })

  it('flattens unsafe characters inside a segment and drops climbing segments', () => {
    expect(sanitiseRepoIdentity('github.com/o r g/re:po')).toBe('github.com/o-r-g/re-po')
    expect(sanitiseRepoIdentity('github.com/../repo')).toBe('github.com/repo')
  })

  it('keeps two identities that differ past the length cap apart', () => {
    const long = `github.com/${'a'.repeat(400)}`
    const other = `github.com/${'a'.repeat(400)}b`
    expect(sanitiseRepoIdentity(long)).not.toBe(sanitiseRepoIdentity(other))
  })
})

describe('isMemoryFile', () => {
  const directories = ['/home/dev/.atlas/memory', '/home/dev/.atlas/projects/-a/memory']

  it('recognises a memory in either root', () => {
    expect(isMemoryFile({ path: '/home/dev/.atlas/memory/a.md', directories })).toBe(true)
    expect(isMemoryFile({ path: '/home/dev/.atlas/projects/-a/memory/b.md', directories })).toBe(
      true,
    )
  })

  it('excludes the index, which carries no frontmatter to stamp', () => {
    expect(isMemoryFile({ path: '/home/dev/.atlas/memory/MEMORY.md', directories })).toBe(false)
  })

  it('excludes a file that is not markdown', () => {
    expect(isMemoryFile({ path: '/home/dev/.atlas/memory/notes.txt', directories })).toBe(false)
  })

  it('excludes a path outside every root', () => {
    expect(isMemoryFile({ path: '/home/dev/code/atlas/README.md', directories })).toBe(false)
  })

  it('excludes a nested file, because memories are flat in their directory', () => {
    expect(isMemoryFile({ path: '/home/dev/.atlas/memory/deeper/a.md', directories })).toBe(false)
  })

  it('tolerates a trailing separator on a configured root', () => {
    expect(
      isMemoryFile({ path: '/home/dev/.atlas/memory/a.md', directories: ['/home/dev/.atlas/memory/'] }),
    ).toBe(true)
  })
})
