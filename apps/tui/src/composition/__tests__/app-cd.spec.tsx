import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ESettingId } from '@dltech/atlas-core'

import { grammarsReady } from '../../ui/markdown/__tests__/harness'
import type { OpenedConversation } from '../open-conversation'
import { open, spokenIn, until, REPLY, THREAD, THINKING } from './app-fixture'
import { fakeApp, scriptedModelPort } from './fake-app'

await grammarsReady()

const WITHIN_MS = 20_000

const UNSTARTED: OpenedConversation = {
  threadId: THREAD,
  events: [],
  turns: [],
  name: null,
  started: false,
}

const speaking = (settings?: Parameters<typeof fakeApp>[0]['settings']) =>
  fakeApp({
    model: scriptedModelPort({ script: { thinking: THINKING, reply: REPLY } }),
    ...(settings === undefined ? {} : { settings }),
  })

const held: string[] = []

afterEach(async () => {
  await Promise.all(held.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

const makeDirectory = async (): Promise<string> => {
  const made = await mkdtemp(join(tmpdir(), 'atlas-cd-app-'))
  held.push(made)
  return realpath(made)
}

const directoryEvents = (app: ReturnType<typeof speaking>) =>
  app.log.peek({ threadId: THREAD }).filter((event) => event.type === 'directory-changed')

describe('the cd command', () => {
  it('moves a started conversation, recording the move in the log', async () => {
    const target = await makeDirectory()
    const app = speaking()
    const mounted = await open({ app, opened: await spokenIn(app) })

    try {
      await mounted.typeText(`/cd ${target}`)
      mounted.pressEnter()

      const landed = await until({
        holds: async () => directoryEvents(app).length > 0,
        within: WITHIN_MS,
      })

      expect(landed).toBe(true)
      expect(directoryEvents(app)[0]).toMatchObject({ path: target })
      expect(app.openedDirectories).toContain(target)

      const frame = await mounted.frame()
      expect(frame).toContain('now works in')
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('answers a bare /cd with the current directory and moves nothing', async () => {
    const app = speaking()
    const mounted = await open({ app, opened: await spokenIn(app) })

    try {
      await mounted.typeText('/cd')
      mounted.pressEnter()

      const frame = await mounted.frame()
      expect(frame).toContain('is working in /workspace/atlas')
      expect(directoryEvents(app)).toEqual([])
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('refuses a missing directory and hands the draft back', async () => {
    const app = speaking()
    const mounted = await open({ app, opened: await spokenIn(app) })

    try {
      await mounted.typeText('/cd /never/was/there')
      mounted.pressEnter()

      await mounted.frame()

      expect(directoryEvents(app)).toEqual([])
      expect(mounted.draftText()).toBe('/cd /never/was/there')
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('refuses to move while the conversation runs in a container', async () => {
    const target = await makeDirectory()
    const app = speaking({ values: { [ESettingId.ExecutionLocation]: 'docker' } })
    const mounted = await open({ app, opened: await spokenIn(app) })

    try {
      await mounted.typeText(`/cd ${target}`)
      mounted.pressEnter()

      await mounted.frame()

      expect(directoryEvents(app)).toEqual([])
      expect(mounted.draftText()).toBe(`/cd ${target}`)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('holds a move made before the thread exists and opens the thread there', async () => {
    const target = await makeDirectory()
    const app = speaking()
    const mounted = await open({ app, opened: UNSTARTED })

    try {
      await mounted.typeText(`/cd ${target}`)
      mounted.pressEnter()

      const announced = await until({
        holds: async () => app.openedDirectories.includes(target),
        within: WITHIN_MS,
      })
      expect(announced).toBe(true)
      expect(directoryEvents(app)).toEqual([])

      await mounted.typeText('look around')
      mounted.pressEnter()

      const landed = await until({
        holds: async () => directoryEvents(app).length > 0,
        within: WITHIN_MS,
      })

      expect(landed).toBe(true)
      const [first, second] = app.log.peek({ threadId: THREAD })
      expect(first).toMatchObject({ type: 'directory-changed', path: target })
      expect(second).toMatchObject({ type: 'user-said', text: 'look around' })
      expect(app.threads.createdWith[0]).toMatchObject({ workspace: target, repo: null })
    } finally {
      await mounted.done()
    }
  }, 60_000)
})
