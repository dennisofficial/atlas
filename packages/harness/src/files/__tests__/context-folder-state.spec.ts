import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { toThreadId } from '@dltech/atlas-core'

import { registryFor } from '../../store/sessions/registry'
import { sessionDirectory } from '../../store/sessions/paths'
import { CONTEXT_FOLDER_STATE_FILE_NAME, createSessionContextFolderStateStore } from '../context-folder-state'

const homes: string[] = []
afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
})

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'atlas-context-folders-'))
  homes.push(home)
  const root = toThreadId('root')
  const child = toThreadId('child')
  const other = toThreadId('other')
  const sessionDir = sessionDirectory({ home, sessionId: root })
  const otherDir = sessionDirectory({ home, sessionId: other })
  const registry = registryFor({ home })
  registry.registerThread({ sessionDir, threadId: root })
  registry.registerThread({ sessionDir, threadId: child })
  registry.registerThread({ sessionDir: otherDir, threadId: other })
  return { home, root, child, other, sessionDir, otherDir, file: join(sessionDir, CONTEXT_FOLDER_STATE_FILE_NAME) }
}

describe('session context folder state store', () => {
  it('loads empty when nothing was saved', async () => {
    const { home, root } = await fixture()
    expect(await createSessionContextFolderStateStore({ home, threadId: root }).load()).toEqual([])
  })

  it('loads empty from corrupt JSON and from an invalid shape', async () => {
    const { home, root, sessionDir, file } = await fixture()
    const store = createSessionContextFolderStateStore({ home, threadId: root })
    await mkdir(sessionDir, { recursive: true })
    for (const content of ['{not json', '[]', '{"closed":"a"}', '{"open":["a"]}', 'null']) {
      await writeFile(file, content)
      expect(await store.load()).toEqual([])
    }
  })

  it('rejects on an unrelated read failure instead of reporting empty state', async () => {
    const { home, root, file } = await fixture()
    await mkdir(file, { recursive: true })
    await expect(createSessionContextFolderStateStore({ home, threadId: root }).load()).rejects.toMatchObject({ code: 'EISDIR' })
  })

  it('drops invalid entries and dedupes normalized paths', async () => {
    const { home, root, sessionDir, file } = await fixture()
    await mkdir(sessionDir, { recursive: true })
    await writeFile(file, JSON.stringify({
      closed: ['docs', './docs', 'docs/', 'a//b', '../escape', 'a/../../x', '/abs', '', '.', 3, null, 'ok\0bad', 'plans/q3'],
    }))
    expect(await createSessionContextFolderStateStore({ home, threadId: root }).load())
      .toEqual(['docs', 'a/b', 'plans/q3'])
  })

  it('sanitizes on save and persists only the closed list outside context/', async () => {
    const { home, root, sessionDir, file } = await fixture()
    await createSessionContextFolderStateStore({ home, threadId: root })
      .save(['docs', 'docs/', '../escape', '/abs', 'notes'])
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ closed: ['docs', 'notes'] })
    expect(await readdir(sessionDir)).not.toContain('context')
  })

  it('hydrates a fresh adapter from disk after a restart', async () => {
    const { home, root } = await fixture()
    await createSessionContextFolderStateStore({ home, threadId: root }).save(['a', 'a/b'])
    expect(await createSessionContextFolderStateStore({ home, threadId: root }).load()).toEqual(['a', 'a/b'])
  })

  it('retains entries for folders that do not exist and never needs them on disk', async () => {
    const { home, root, sessionDir } = await fixture()
    const store = createSessionContextFolderStateStore({ home, threadId: root })
    await store.save(['vanished/deep'])
    expect(await readdir(sessionDir)).not.toContain('context')
    expect(await store.load()).toEqual(['vanished/deep'])
  })

  it('keeps sessions isolated from each other', async () => {
    const { home, root, other } = await fixture()
    await createSessionContextFolderStateStore({ home, threadId: root }).save(['mine'])
    expect(await createSessionContextFolderStateStore({ home, threadId: other }).load()).toEqual([])
  })

  it('shares one state between a parent and its child thread', async () => {
    const { home, root, child } = await fixture()
    await createSessionContextFolderStateStore({ home, threadId: child }).save(['shared'])
    expect(await createSessionContextFolderStateStore({ home, threadId: root }).load()).toEqual(['shared'])
  })

  it('applies rapid saves in invocation order so the latest wins', async () => {
    const { home, root } = await fixture()
    const store = createSessionContextFolderStateStore({ home, threadId: root })
    const saves = Array.from({ length: 25 }, (_, index) => store.save([`folder-${index}`]))
    await Promise.all(saves)
    expect(await store.load()).toEqual(['folder-24'])
  })

  it('rejects a failed write and still performs later saves', async () => {
    const { home, root, file } = await fixture()
    const store = createSessionContextFolderStateStore({ home, threadId: root })
    await mkdir(file, { recursive: true })
    const failed = store.save(['lost'])
    const queued = store.save(['kept'])
    await expect(failed).rejects.toBeDefined()
    await expect(queued).rejects.toBeDefined()
    await rm(file, { recursive: true, force: true })
    await store.save(['recovered'])
    expect(await store.load()).toEqual(['recovered'])
  })

  it('does not let one rejected save poison a save queued behind it once the cause clears', async () => {
    const { home, root, file } = await fixture()
    const store = createSessionContextFolderStateStore({ home, threadId: root })
    await mkdir(file, { recursive: true })
    const failed = store.save(['lost'])
    await expect(failed).rejects.toBeDefined()
    await rm(file, { recursive: true, force: true })
    const next = store.save(['after'])
    await expect(next).resolves.toBeUndefined()
    expect(await store.load()).toEqual(['after'])
  })

  it('lets a second adapter load the paths a first adapter just saved without awaiting', async () => {
    const { home, root } = await fixture()
    const first = createSessionContextFolderStateStore({ home, threadId: root })
    const second = createSessionContextFolderStateStore({ home, threadId: root })
    void first.save(['fresh/a', 'fresh/b'])
    expect(await second.load()).toEqual(['fresh/a', 'fresh/b'])
  })

  it('serializes interleaved root and child saves so the last invoked wins', async () => {
    const { home, root, child } = await fixture()
    const rootStore = createSessionContextFolderStateStore({ home, threadId: root })
    const childStore = createSessionContextFolderStateStore({ home, threadId: child })
    const saves = Array.from({ length: 20 }, (_, index) =>
      (index % 2 === 0 ? rootStore : childStore).save([`folder-${index}`]))
    await Promise.all(saves)
    expect(await rootStore.load()).toEqual(['folder-19'])
    expect(await childStore.load()).toEqual(['folder-19'])
  })

  it('keeps loads queued behind a failing save and recovers afterwards', async () => {
    const { home, root, file } = await fixture()
    const store = createSessionContextFolderStateStore({ home, threadId: root })
    await mkdir(file, { recursive: true })
    const failed = store.save(['lost'])
    const loaded = store.load()
    await expect(failed).rejects.toBeDefined()
    await expect(loaded).rejects.toMatchObject({ code: 'EISDIR' })
    await rm(file, { recursive: true, force: true })
    await store.save(['back'])
    expect(await store.load()).toEqual(['back'])
  })

  it('refuses to save for a thread with no registered session and creates no directory', async () => {
    const { home } = await fixture()
    const stranger = toThreadId('stranger')
    const store = createSessionContextFolderStateStore({ home, threadId: stranger })
    await expect(store.save(['x'])).rejects.toBeDefined()
    expect(existsSync(join(home, 'sessions', 'stranger'))).toBe(false)
    expect(await store.load()).toEqual([])
  })
})
