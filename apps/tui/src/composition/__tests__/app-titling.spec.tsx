import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { testRender } from '@opentui/react/test-utils'
import { EImageDelivery } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'
import React from 'react'

import { grammarsReady, settle, teardown } from '../../ui/markdown/__tests__/harness'
import type { ClipboardImage, ClipboardImageReader } from '../../ui/clipboard-image'
import { App } from '../app'
import { open, until, THREAD, REPLY, THINKING } from './app-fixture'
import { fakeApp, scriptedModelPort, type FakeApp } from './fake-app'

await grammarsReady()

const NAME = 'Refresh-token rotation'

const HANDLE = 'refresh-token-rotation'

const OPENING = 'the refresh token never rotates'

// The harness TitlingTurnRunner names a session the moment the opening message is sent — from
// the message and its attachments, before the reply exists, so a long first turn shimmers with
// the title in flight rather than sitting unnamed until the loop settles.
const OPENING_DIGEST = `Operator: ${OPENING}`

const FOLLOW_UP = 'and cover reuse detection'

const WITHIN_MS = 20_000

const script = { thinking: THINKING, reply: REPLY }

const naming = (names: string | null): FakeApp =>
  fakeApp({ model: scriptedModelPort({ script }), names })

const SHOT_WIDTH = 560
const SHOT_HEIGHT = 280

/** Signature plus IHDR is all `pngSize` reads, and all this fixture has to be. */
const tinyPng = (): Buffer => {
  const header = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0)
  header.writeUInt32BE(13, 8)
  header.write('IHDR', 12, 'ascii')
  header.writeUInt32BE(SHOT_WIDTH, 16)
  header.writeUInt32BE(SHOT_HEIGHT, 20)
  return header
}

const screenshotOnClipboard = (): ClipboardImageReader => {
  const bytes = tinyPng()
  const path = join(mkdtempSync(join(tmpdir(), 'atlas-paste-')), 'shot.png')
  writeFileSync(path, bytes)

  return async (): Promise<ClipboardImage> => ({
    path,
    mediaType: 'image/png',
    byteLength: bytes.byteLength,
    width: SHOT_WIDTH,
    height: SHOT_HEIGHT,
    delivery: EImageDelivery.Inline,
    tokens: 200,
  })
}

describe('naming a session from its opening message', () => {
  it('asks for a name and writes it to the thread', async () => {
    const mounted = await open({ app: naming(NAME) })

    try {
      await mounted.typeText(OPENING)
      mounted.pressEnter()

      const named = await until({
        holds: async () => {
          await mounted.frame()
          return mounted.app.threads.renames.length > 0
        },
        within: WITHIN_MS,
      })

      expect(named).toBe(true)
      expect(mounted.app.titled).toEqual([OPENING_DIGEST])
      expect(mounted.app.threads.renames).toEqual([{ threadId: THREAD, title: NAME }])
    } finally {
      await mounted.done()
    }
  })

  it('shows the titler a screenshot the opening message pasted', async () => {
    const mounted = await open({ app: naming(NAME), clipboard: screenshotOnClipboard() })

    try {
      mounted.pressCtrl('v')
      await mounted.frame()
      await mounted.typeText('can we fix this')

      mounted.pressEnter()

      const named = await until({
        holds: async () => {
          await mounted.frame()
          return mounted.app.threads.renames.length > 0
        },
        within: WITHIN_MS,
      })

      expect(named).toBe(true)
      expect(mounted.app.titledImages[0]).toHaveLength(1)
      expect(mounted.app.titledImages[0]?.[0]).toMatchObject({
        mediaType: 'image/png',
        width: SHOT_WIDTH,
        height: SHOT_HEIGHT,
      })
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('asks once, however many turns the session runs', async () => {
    const mounted = await open({ app: naming(NAME) })

    try {
      await mounted.typeText(OPENING)
      mounted.pressEnter()

      const settled = await until({
        holds: async () => (await mounted.frame()).includes(REPLY),
        within: WITHIN_MS,
      })
      expect(settled).toBe(true)

      await mounted.typeText(FOLLOW_UP)
      mounted.pressEnter()

      const ran = await until({
        holds: async () => {
          await mounted.frame()
          return mounted.app.turnsDriven === 2
        },
        within: WITHIN_MS,
      })

      expect(ran).toBe(true)
      expect(mounted.app.titled).toEqual([OPENING_DIGEST])
      expect(mounted.app.threads.renames).toHaveLength(1)
    } finally {
      await mounted.done()
    }
  })

  it('leaves the thread unnamed when the titler declines, rather than failing the turn', async () => {
    const mounted = await open({ app: naming(null) })

    try {
      await mounted.typeText(OPENING)
      mounted.pressEnter()

      const settled = await until({
        holds: async () => (await mounted.frame()).includes(REPLY),
        within: WITHIN_MS,
      })

      expect(settled).toBe(true)
      expect(mounted.app.titled).toEqual([OPENING_DIGEST])
      expect(mounted.app.threads.renames).toEqual([])
    } finally {
      await mounted.done()
    }
  })

  it('drops the name when a new conversation starts, rather than carrying it over', async () => {
    const app = naming(NAME)
    const setup = await testRender(
      <App app={app} opened={{ threadId: THREAD, events: [], turns: [], name: null, started: true }} />,
      { width: 140, height: 40 },
    )

    const frame = async (): Promise<string> => {
      await setup.flush()
      await settle(250)
      await setup.flush()
      return setup.captureCharFrame()
    }

    try {
      await setup.mockInput.typeText(OPENING)
      setup.mockInput.pressEnter()

      expect(await until({ holds: async () => (await frame()).includes(NAME), within: WITHIN_MS })).toBe(true)

      await setup.mockInput.typeText('/new')
      setup.mockInput.pressEnter()

      const dropped = await until({
        holds: async () => !(await frame()).includes(NAME),
        within: WITHIN_MS,
      })

      expect(dropped).toBe(true)
    } finally {
      await teardown(setup)
    }
  })

  it('heads the sidebar with the name once it lands', async () => {
    const app = naming(NAME)
    const setup = await testRender(
      <App app={app} opened={{ threadId: THREAD, events: [], turns: [], name: null, started: true }} />,
      { width: 140, height: 40 },
    )

    try {
      await setup.flush()
      await setup.mockInput.typeText(OPENING)
      setup.mockInput.pressEnter()

      const headed = await until({
        holds: async () => {
          await setup.flush()
          await settle(250)
          await setup.flush()
          return setup.captureCharFrame().includes(NAME)
        },
        within: WITHIN_MS,
      })

      expect(headed).toBe(true)
    } finally {
      await teardown(setup)
    }
  })

  it('heads the composer with the handle the session resumes by, not the written name', async () => {
    const app = naming(NAME)
    const setup = await testRender(
      <App app={app} opened={{ threadId: THREAD, events: [], turns: [], name: null, started: true }} />,
      { width: 140, height: 40 },
    )

    try {
      await setup.flush()
      await setup.mockInput.typeText(OPENING)
      setup.mockInput.pressEnter()

      const headed = await until({
        holds: async () => {
          await setup.flush()
          await settle(250)
          await setup.flush()
          return setup.captureCharFrame().includes(HANDLE)
        },
        within: WITHIN_MS,
      })

      expect(headed).toBe(true)
    } finally {
      await teardown(setup)
    }
  })
})

const NOISE_CELL = /[·:∙]/

describe('the fallback title while the titler is still answering', () => {
  it('runs the naming animation until the generated name lands', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const app = fakeApp({ model: scriptedModelPort({ script }), names: NAME, titlerWait: gate })
    const setup = await testRender(
      <App app={app} opened={{ threadId: THREAD, events: [], turns: [], name: null, started: true }} />,
      { width: 140, height: 40 },
    )

    const frame = async (): Promise<string> => {
      await setup.flush()
      await settle(250)
      await setup.flush()
      return setup.captureCharFrame()
    }

    try {
      await setup.mockInput.typeText(OPENING)
      setup.mockInput.pressEnter()

      const asked = await until({
        holds: async () => {
          await setup.flush()
          return app.titled.length > 0
        },
        within: WITHIN_MS,
      })
      expect(asked).toBe(true)

      const pending = await until({
        holds: async () => {
          const shot = await frame()
          return NOISE_CELL.test(shot) && !shot.includes(NAME)
        },
        within: WITHIN_MS,
      })
      expect(pending).toBe(true)

      release()

      const named = await until({
        holds: async () => {
          const shot = await frame()
          return shot.includes(NAME)
        },
        within: WITHIN_MS,
      })
      expect(named).toBe(true)
      expect(app.threads.renames).toEqual([{ threadId: THREAD, title: NAME }])
    } finally {
      release()
      await teardown(setup)
    }
  })
})

const RENAMED = 'Doing something cool'

describe('the title while the opening turn is still running', () => {
  it('lands before the reply finishes streaming', async () => {
    // A turn paced at 40ms a chunk runs for seconds; the titler answers off the opening the
    // moment it is committed, so the name must head the sidebar while the reply is mid-stream.
    const app = fakeApp({ model: scriptedModelPort({ script, perChunkMs: 40 }), names: NAME })
    const setup = await testRender(
      <App app={app} opened={{ threadId: THREAD, events: [], turns: [], name: null, started: true }} />,
      { width: 140, height: 40 },
    )

    try {
      await setup.mockInput.typeText(OPENING)
      setup.mockInput.pressEnter()

      const namedMidTurn = await until({
        holds: async () => {
          await setup.flush()
          await settle(60)
          await setup.flush()
          const shot = setup.captureCharFrame()
          return shot.includes(NAME) && !shot.includes(REPLY)
        },
        within: WITHIN_MS,
      })

      expect(namedMidTurn).toBe(true)
      expect(app.threads.renames).toEqual([{ threadId: THREAD, title: NAME }])
    } finally {
      await teardown(setup)
    }
  }, 60_000)
})

describe('renaming a session with /rename', () => {
  it('takes the name the operator wrote, without asking the titler', async () => {
    const mounted = await open({ app: naming(NAME) })

    try {
      await mounted.typeText(`/rename ${RENAMED}`)
      mounted.pressEnter()

      const named = await until({
        holds: async () => {
          await mounted.frame()
          return mounted.app.threads.renames.length > 0
        },
        within: WITHIN_MS,
      })

      expect(named).toBe(true)
      expect(mounted.app.threads.renames).toEqual([{ threadId: THREAD, title: RENAMED }])
      expect(mounted.app.titled).toEqual([])
    } finally {
      await mounted.done()
    }
  })

  it('names the session again from the transcript when no name is written', async () => {
    const mounted = await open({ app: naming(NAME) })

    try {
      await mounted.typeText(OPENING)
      mounted.pressEnter()

      expect(
        await until({ holds: async () => (await mounted.frame()).includes(REPLY), within: WITHIN_MS }),
      ).toBe(true)

      await mounted.typeText('/rename')
      mounted.pressEnter()

      const named = await until({
        holds: async () => {
          await mounted.frame()
          return mounted.app.titled.length > 1
        },
        within: WITHIN_MS,
      })

      expect(named).toBe(true)
      expect(mounted.app.titled.at(-1)).toContain(`Operator: ${OPENING}`)
      expect(mounted.app.titled.at(-1)).toContain(REPLY)
      expect(mounted.app.threads.renames.at(-1)).toEqual({ threadId: THREAD, title: NAME })
    } finally {
      await mounted.done()
    }
  })

  it('shows the renamed title once the ask settles, not only after a restart', async () => {
    const app = naming(NAME)
    const mounted = await open({ app })

    try {
      await mounted.typeText(OPENING)
      mounted.pressEnter()

      expect(
        await until({
          holds: async () => (await mounted.frame()).includes(REPLY),
          within: WITHIN_MS,
        }),
      ).toBe(true)

      await mounted.typeText('/rename')
      mounted.pressEnter()

      // The rename echo clears the naming flag, the generating animation ends, and the settled
      // handle heads the composer — all without reopening the session. The composer's head row is
      // the line that holds the handle; while the animation owns that row it is noise dots, so a
      // head row that reads the handle cleanly is the settle.
      const settled = await until({
        holds: async () => {
          const shot = await mounted.frame()
          const renamed = mounted.app.threads.renames.at(-1)?.title === NAME
          const headRow = shot.split('\n').find((line) => line.includes(HANDLE)) ?? ''
          return renamed && headRow.includes(HANDLE) && !NOISE_CELL.test(headRow)
        },
        within: WITHIN_MS,
      })

      expect(settled).toBe(true)
    } finally {
      await mounted.done()
    }
  })

  it('holds the new name through the animation and settles onto it', async () => {
    const app = naming(NAME)
    const mounted = await open({ app })

    try {
      await mounted.typeText(OPENING)
      mounted.pressEnter()
      await until({ holds: async () => (await mounted.frame()).includes(REPLY), within: WITHIN_MS })

      // An explicit rename resolves instantly, which is the case that used to snap straight to the
      // new name: the whole begin/stream/settle lifecycle batched into one commit. The animation
      // now owns the title line for a minimum window, so the composer holds the rename answer while
      // the sweep plays, then settles onto it.
      await mounted.typeText(`/rename ${RENAMED}`)
      mounted.pressEnter()

      const renamed = await until({
        holds: async () => mounted.app.threads.renames.at(-1)?.title === RENAMED,
        within: WITHIN_MS,
      })
      expect(renamed).toBe(true)

      const handle = RENAMED.toLowerCase().replace(/\s+/g, '-')
      const settled = await until({
        holds: async () => (await mounted.frame()).includes(handle),
        within: WITHIN_MS,
      })
      expect(settled).toBe(true)
    } finally {
      await mounted.done()
    }
  })

  it('says what to do when there is nothing said yet to name the session from', async () => {
    const mounted = await open({ app: naming(NAME) })

    try {
      await mounted.typeText('/rename')
      mounted.pressEnter()

      const refused = await until({
        holds: async () => (await mounted.frame()).includes('nothing to read yet'),
        within: WITHIN_MS,
      })

      expect(refused).toBe(true)
      expect(mounted.app.threads.renames).toEqual([])
    } finally {
      await mounted.done()
    }
  })
})
