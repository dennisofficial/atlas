import { parseColor } from '@opentui/core'
import { afterEach, describe, expect, it } from 'vitest'

import { grammarsReady } from '../../ui/markdown/__tests__/harness'
import { currentNotices, dismissNotice } from '../../ui/notice-store'
import { theme } from '../../ui/theme'
import { promiseGate, until } from './app-fixture'
import {
  bornThreadApp,
  fakeProjectsApi,
  mountUnborn,
  projectOf,
  type MountedUnborn,
} from './born-thread-fixture'

await grammarsReady()

afterEach(() => dismissNotice())

const OTHER = [
  projectOf({
    id: 'proj-old',
    name: 'stale-proj',
    repo: 'acme/stale-proj',
    updatedAt: '2026-02-01T00:00:00.000Z',
  }),
  projectOf({
    id: 'proj-new',
    name: 'fresh-proj',
    repo: null,
    updatedAt: '2026-03-01T00:00:00.000Z',
  }),
]

const born = (mounted: MountedUnborn): Promise<boolean> =>
  until({ holds: async () => mounted.bridge.created.length > 0, within: 20_000 })

const hoverWashAt = (args: {
  mounted: MountedUnborn
  row: number
  column: number
}): boolean | undefined => {
  const painted = args.mounted.paintedLines() as unknown as {
    lines: (
      | { spans: { text: string; bg: { equals: (other: unknown) => boolean } }[] }
      | undefined
    )[]
  }
  let at = 0
  for (const span of painted.lines[args.row]?.spans ?? []) {
    const width = [...span.text].length
    if (args.column < at + width) return span.bg.equals(parseColor(theme.hoverBg))
    at += width
  }
  return undefined
}

describe('the project prompt', () => {
  it('keeps the arrows and Enter for itself while a composer menu was open underneath', async () => {
    const listing = promiseGate()
    const api = fakeProjectsApi({ projects: OTHER, listGate: listing.gate })
    const mounted = await mountUnborn({ app: bornThreadApp({ api, origin: null }) })

    try {
      await mounted.command('hello')
      await mounted.input.typeText('/')
      expect(await mounted.frameHolds((frame) => frame.includes('/help'))).toBe(true)

      listing.release()
      expect(
        await mounted.frameHolds((frame) => frame.includes('RUN THIS THREAD IN A PROJECT')),
      ).toBe(true)
      expect(await mounted.frame()).not.toContain('/help')

      mounted.input.pressArrow('down')
      await mounted.frame()
      mounted.input.pressEnter()

      expect(await born(mounted)).toBe(true)
      expect(mounted.bridge.created.map((made) => made.projectId)).toEqual(['proj-old'])
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('washes the cancel footer under the pointer', async () => {
    const mounted = await mountUnborn({
      app: bornThreadApp({ api: fakeProjectsApi({ projects: OTHER }), origin: null }),
    })

    try {
      await mounted.command('hover footer')
      expect(await mounted.frameHolds((frame) => frame.includes('cancel'))).toBe(true)

      const lines = (await mounted.frame()).split('\n')
      const row = lines.findIndex((line) => line.includes('esc cancel'))
      const column = lines[row]?.indexOf('esc cancel') ?? -1
      expect(row).toBeGreaterThan(0)
      expect(hoverWashAt({ mounted, row, column })).toBe(false)

      await mounted.mouse.moveTo(column, row)
      await mounted.frame()

      expect(hoverWashAt({ mounted, row, column })).toBe(true)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('warns, restores the draft, and births nothing when the project cannot be created', async () => {
    const api = fakeProjectsApi({ projects: OTHER, createFails: true })
    const mounted = await mountUnborn({ app: bornThreadApp({ api }) })

    try {
      await mounted.command('will fail')
      expect(await mounted.frameHolds((frame) => frame.includes('CREATE A PROJECT'))).toBe(true)
      mounted.input.pressEnter()

      expect(
        await until({
          holds: async () =>
            currentNotices().some((notice) => notice.text.includes('could not create the project')),
          within: 20_000,
        }),
      ).toBe(true)
      expect(
        await until({ holds: async () => mounted.draft() === 'will fail', within: 20_000 }),
      ).toBe(true)
      expect(mounted.bridge.created).toEqual([])
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('creates and births nothing when the list resolves after the workspace is gone', async () => {
    const listing = promiseGate()
    const api = fakeProjectsApi({ projects: [], listGate: listing.gate })
    const mounted = await mountUnborn({ app: bornThreadApp({ api }) })

    await mounted.command('too late')
    const { bridge } = mounted
    await mounted.done()
    listing.release()
    await new Promise((resolve) => setTimeout(resolve, 500))

    expect(api.created).toEqual([])
    expect(bridge.created).toEqual([])
  }, 60_000)
})
