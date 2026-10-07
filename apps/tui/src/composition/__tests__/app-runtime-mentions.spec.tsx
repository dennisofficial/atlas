import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EClientRequest, RemoteMentionFiles } from '@dltech/atlas-harness'

import { grammarsReady } from '../../ui/markdown/__tests__/harness'
import { dismissNotice } from '../../ui/notice-store'
import { open, THREAD, type Mounted } from './app-fixture'
import { fakeApp, scriptedModelPort } from './fake-app'

await grammarsReady()
const mounted: Mounted[] = []
const roots: string[] = []

afterEach(async () => {
  for (const setup of mounted.splice(0)) await setup.done()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
  dismissNotice()
})

const localApp = async () => {
  const root = await mkdtemp(join(tmpdir(), 'atlas-composer-runtime-'))
  roots.push(root)
  await writeFile(join(root, 'local-only.txt'), 'local-only contents')
  await writeFile(join(root, 'shared.txt'), 'host contents must not be attached')
  return fakeApp({
    workspaceRoot: root,
    model: scriptedModelPort({ script: { thinking: '', reply: 'read the cloud file' } }),
  })
}

describe('the composer with a cloud mention reader', () => {
  it('renders only cloud completions and sends cloud context', async () => {
    const app = await localApp()
    app.files = new RemoteMentionFiles({
      threadId: THREAD,
      channel: {
        request: async ({ op }) => {
          if (op === EClientRequest.ListMentionFiles) {
            return {
              entries: [
                { name: 'cloud-only.txt', isDirectory: false },
                { name: 'shared.txt', isDirectory: false },
              ],
            }
          }
          if (op === EClientRequest.MentionFileExists) return { exists: true }
          return {
            file: { type: 'text', path: 'shared.txt', content: 'cloud context', truncated: false },
          }
        },
      },
    })
    const setup = await open({ app })
    mounted.push(setup)
    await setup.typeText('@')
    const menu = await setup.frame()
    expect(menu).toContain('cloud-only.txt')
    expect(menu).not.toContain('local-only.txt')
    setup.pressBackspace()
    await setup.typeText('read @shared.txt ')
    await setup.frame()
    setup.pressEnter()
    await setup.frame()
    const events = await app.log.read({ threadId: THREAD })
    const files = events.filter((event) => event.type === 'context-loaded' && event.slot === 'file')
    expect(files).toHaveLength(1)
    expect(files[0]).toMatchObject({ key: 'shared.txt', content: 'cloud context' })
    expect(
      events.some((event) => event.type === 'user-said' && event.text === 'read @shared.txt'),
    ).toBe(true)
  }, 30_000)

  it('keeps the draft visible during preparation and prevents duplicate sends', async () => {
    const app = await localApp()
    let loads = 0
    let release: (value: unknown) => void = () => undefined
    const waiting = new Promise<unknown>((resolve) => {
      release = resolve
    })
    app.files = new RemoteMentionFiles({
      threadId: THREAD,
      channel: {
        request: async ({ op }) => {
          if (op === EClientRequest.ListMentionFiles) return { entries: [] }
          if (op === EClientRequest.MentionFileExists) return { exists: true }
          loads += 1
          return waiting
        },
      },
    })
    const setup = await open({ app })
    mounted.push(setup)
    await setup.typeText('read @shared.txt ')
    await setup.frame()
    setup.pressEnter()
    expect(await setup.frame()).toContain('Reading mentioned files')
    expect(setup.draftText()).toBe('read @shared.txt ')
    setup.pressEnter()
    await setup.frame()
    expect(loads).toBe(1)
    release({
      file: {
        type: 'text',
        path: 'shared.txt',
        content: 'prepared cloud context',
        truncated: false,
      },
    })
    await setup.frame()
    expect(
      (await app.log.read({ threadId: THREAD })).filter((event) => event.type === 'user-said'),
    ).toHaveLength(1)
    expect(setup.draftText()).toBe('')
  }, 30_000)

  it('lets a newer edited submission supersede an unresolved mention read', async () => {
    const app = await localApp()
    let release: (value: unknown) => void = () => undefined
    const waiting = new Promise<unknown>((resolve) => {
      release = resolve
    })
    app.files = new RemoteMentionFiles({
      threadId: THREAD,
      channel: {
        request: async ({ op }) => {
          if (op === EClientRequest.ListMentionFiles) return { entries: [] }
          if (op === EClientRequest.MentionFileExists) return { exists: true }
          return waiting
        },
      },
    })
    const setup = await open({ app })
    mounted.push(setup)
    await setup.typeText('read @shared.txt ')
    await setup.frame()
    setup.pressEnter()
    await setup.frame()
    setup.editor()?.setText('a newer message')
    setup.pressEnter()
    await setup.frame()
    release({
      file: { type: 'text', path: 'shared.txt', content: 'stale cloud context', truncated: false },
    })
    await setup.frame()
    const users = (await app.log.read({ threadId: THREAD })).filter(
      (event) => event.type === 'user-said',
    )
    expect(users).toHaveLength(1)
    expect(users[0]).toMatchObject({ text: 'a newer message' })
    expect(setup.draftText()).toBe('')
  }, 30_000)

  it('restores the draft and shows an error when a remote file read fails', async () => {
    const app = await localApp()
    app.files = new RemoteMentionFiles({
      threadId: THREAD,
      channel: {
        request: async ({ op }) => {
          if (op === EClientRequest.ListMentionFiles) return { entries: [] }
          if (op === EClientRequest.MentionFileExists) return { exists: true }
          throw new Error('the cloud file could not be read')
        },
      },
    })
    const setup = await open({ app })
    mounted.push(setup)
    await setup.typeText('read @shared.txt ')
    await setup.frame()
    setup.pressEnter()
    const frame = await setup.frame()
    expect(frame).toContain('the cloud file could not be read')
    expect(setup.draftText()).toBe('read @shared.txt ')
    expect(
      (await app.log.read({ threadId: THREAD })).some((event) => event.type === 'user-said'),
    ).toBe(false)
  }, 30_000)
})
