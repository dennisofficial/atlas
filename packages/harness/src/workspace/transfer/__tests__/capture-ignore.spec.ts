import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'bun:test'

import { resolveIgnoreFilter } from '../capture-ignore'
import { cleanupScratches, createScratch, git } from './capture-fixture'

afterEach(cleanupScratches)

async function repo(): Promise<string> {
  const root = await createScratch()
  await git({ args: ['init', '-b', 'main'], cwd: root })
  await writeFile(join(root, '.gitignore'), 'node_modules/\ndist/\n*.log\n.atlas/\n')
  await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true })
  await writeFile(join(root, 'node_modules', 'pkg', 'index.js'), 'x\n')
  await mkdir(join(root, 'dist'), { recursive: true })
  await writeFile(join(root, 'dist', 'bundle.js'), 'x\n')
  await writeFile(join(root, 'debug.log'), 'x\n')
  await writeFile(join(root, 'app.ts'), 'x\n')
  await mkdir(join(root, '.atlas'), { recursive: true })
  await writeFile(join(root, '.atlas', 'state.json'), '{}\n')
  return root
}

describe('resolveIgnoreFilter', () => {
  test('excludes ignored untracked files and directories', async () => {
    const root = await repo()
    const filter = await resolveIgnoreFilter({ cwd: root })
    expect(filter.isCaptured('node_modules/pkg/index.js')).toBe(false)
    expect(filter.isCaptured('dist/bundle.js')).toBe(false)
    expect(filter.isCaptured('debug.log')).toBe(false)
  })

  test('keeps tracked and untracked non-ignored files', async () => {
    const root = await repo()
    await git({ args: ['add', 'app.ts'], cwd: root })
    const filter = await resolveIgnoreFilter({ cwd: root })
    expect(filter.isCaptured('app.ts')).toBe(true)
  })

  test('keeps tracked files even when gitignored', async () => {
    const root = await repo()
    await writeFile(join(root, 'tracked.log'), 'x\n')
    await git({ args: ['add', '-f', 'tracked.log'], cwd: root })
    const filter = await resolveIgnoreFilter({ cwd: root })
    expect(filter.isCaptured('tracked.log')).toBe(true)
  })

  test('force-includes paths named in .atlas/.cloudinclude', async () => {
    const root = await repo()
    await writeFile(join(root, '.atlas', '.cloudinclude'), 'dist/\n')
    const filter = await resolveIgnoreFilter({ cwd: root })
    expect(filter.isCaptured('dist/bundle.js')).toBe(true)
    expect(filter.isCaptured('node_modules/pkg/index.js')).toBe(false)
  })

  test('always captures the .cloudinclude file itself even under an ignored .atlas/', async () => {
    const root = await repo()
    await writeFile(join(root, '.atlas', '.cloudinclude'), 'dist/\n')
    const filter = await resolveIgnoreFilter({ cwd: root })
    expect(filter.isCaptured('.atlas/.cloudinclude')).toBe(true)
  })

  test('captures everything when nothing is ignored', async () => {
    const root = await createScratch()
    await git({ args: ['init', '-b', 'main'], cwd: root })
    await writeFile(join(root, 'a.ts'), 'x\n')
    const filter = await resolveIgnoreFilter({ cwd: root })
    expect(filter.isCaptured('a.ts')).toBe(true)
    expect(filter.isCaptured('anything/at/all')).toBe(true)
  })
})
