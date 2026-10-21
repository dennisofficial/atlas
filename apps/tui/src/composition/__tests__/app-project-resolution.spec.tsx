import { parseColor } from '@opentui/core'
import { afterEach, describe, expect, it } from 'vitest'

import { grammarsReady } from '../../ui/markdown/__tests__/harness'
import { currentNotices, dismissNotice } from '../../ui/notice-store'
import { NO_PROJECTS_HINT } from '../../ui/components/project-prompt'
import { NO_WORKSPACE_LABEL } from '../../ui/project-prompt-model'
import { theme } from '../../ui/theme'
import { until } from './app-fixture'
import { bornThreadApp, fakeProjectsApi, mountUnborn, projectOf, type MountedUnborn } from './born-thread-fixture'

await grammarsReady()

afterEach(() => dismissNotice())

const OTHER = [
  projectOf({ id: 'proj-old', name: 'stale-proj', repo: 'acme/stale-proj', updatedAt: '2026-02-01T00:00:00.000Z' }),
  projectOf({ id: 'proj-new', name: 'fresh-proj', repo: null, updatedAt: '2026-03-01T00:00:00.000Z' }),
]

const noticeNaming = (text: string): Promise<boolean> =>
  until({ holds: async () => currentNotices().some((notice) => notice.text.includes(text)), within: 20_000 })

const born = (mounted: MountedUnborn): Promise<boolean> =>
  until({ holds: async () => mounted.bridge.created.length > 0, within: 20_000 })

const draftIs = (mounted: MountedUnborn, text: string): Promise<boolean> =>
  until({ holds: async () => mounted.draft() === text, within: 20_000 })

describe('resolving a project on the first send', () => {
  it('births silently on the project whose repository matches the origin', async () => {
    const api = fakeProjectsApi()
    const mounted = await mountUnborn({ app: bornThreadApp({ api }) })

    try {
      await mounted.command('hello')

      expect(await born(mounted)).toBe(true)
      expect(mounted.bridge.created.map((made) => made.projectId)).toEqual(['proj-acme'])
      expect(api.created).toEqual([])
      expect(await mounted.frame()).not.toContain('CREATE A PROJECT')
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('opens a prefilled create prompt for an unmatched GitHub origin, and Enter creates then births on the new id', async () => {
    const api = fakeProjectsApi({ projects: OTHER })
    const mounted = await mountUnborn({ app: bornThreadApp({ api }) })

    try {
      await mounted.command('make one')

      expect(await mounted.frameHolds((frame) => frame.includes('CREATE A PROJECT FOR THIS REPOSITORY'))).toBe(true)
      const shown = await mounted.frame()
      expect(shown).toContain('acme/widgets')
      expect(shown).toContain('widgets')
      expect(shown).toContain('REPOSITORY')
      expect(shown).toContain('BASE BRANCH')
      expect(mounted.bridge.created).toEqual([])

      mounted.input.pressEnter()

      expect(await born(mounted)).toBe(true)
      expect(api.created).toEqual([{ name: 'widgets', repo: 'acme/widgets', baseBranch: 'main', additionalRepos: [] }])
      expect(mounted.bridge.created.map((made) => made.projectId)).toEqual(['proj-new'])
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('edits the name, switches fields with Tab, and creates with what was typed', async () => {
    const api = fakeProjectsApi({ projects: [] })
    const mounted = await mountUnborn({ app: bornThreadApp({ api }) })

    try {
      await mounted.command('typed')
      expect(await mounted.frameHolds((frame) => frame.includes('CREATE A PROJECT'))).toBe(true)

      for (let at = 0; at < 'widgets'.length; at += 1) mounted.input.pressBackspace()
      await mounted.input.typeText('Acme Web')
      mounted.input.pressTab()
      for (let at = 0; at < 'main'.length; at += 1) mounted.input.pressBackspace()
      await mounted.input.typeText('develop')
      await mounted.frame()
      mounted.input.pressEnter()

      expect(await born(mounted)).toBe(true)
      expect(api.created).toEqual([{ name: 'Acme Web', repo: 'acme/widgets', baseBranch: 'develop', additionalRepos: [] }])
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('creates nothing, births nothing, and restores the draft when the create prompt is cancelled', async () => {
    const api = fakeProjectsApi({ projects: OTHER })
    const mounted = await mountUnborn({ app: bornThreadApp({ api }) })

    try {
      await mounted.command('never mind')
      expect(await mounted.frameHolds((frame) => frame.includes('CREATE A PROJECT'))).toBe(true)

      mounted.dismiss()

      expect(await draftIs(mounted, 'never mind')).toBe(true)
      expect(await mounted.frameHolds((frame) => !frame.includes('CREATE A PROJECT'))).toBe(true)
      expect(api.created).toEqual([])
      expect(mounted.bridge.created).toEqual([])
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('lists projects newest first with a final No workspace row when there is no origin', async () => {
    const api = fakeProjectsApi({ projects: OTHER })
    const mounted = await mountUnborn({ app: bornThreadApp({ api, origin: null }) })

    try {
      await mounted.command('where to')

      expect(await mounted.frameHolds((frame) => frame.includes('RUN THIS THREAD IN A PROJECT'))).toBe(true)
      const shown = await mounted.frame()
      expect(shown.indexOf('fresh-proj')).toBeGreaterThan(-1)
      expect(shown.indexOf('fresh-proj')).toBeLessThan(shown.indexOf('stale-proj'))
      expect(shown.indexOf('stale-proj')).toBeLessThan(shown.indexOf(NO_WORKSPACE_LABEL))
      expect(shown).not.toContain(NO_PROJECTS_HINT)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('births with a null project when No workspace is chosen', async () => {
    const mounted = await mountUnborn({ app: bornThreadApp({ api: fakeProjectsApi({ projects: OTHER }), origin: null }) })

    try {
      await mounted.command('no project')
      expect(await mounted.frameHolds((frame) => frame.includes(NO_WORKSPACE_LABEL))).toBe(true)

      mounted.input.pressArrow('down')
      mounted.input.pressArrow('down')
      await mounted.frame()
      mounted.input.pressEnter()

      expect(await born(mounted)).toBe(true)
      expect(mounted.bridge.created.map((made) => made.projectId)).toEqual([null])
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('births on the chosen project when a row is picked', async () => {
    const mounted = await mountUnborn({ app: bornThreadApp({ api: fakeProjectsApi({ projects: OTHER }), origin: 'https://gitlab.com/acme/widgets.git' }) })

    try {
      await mounted.command('pick one')
      expect(await mounted.frameHolds((frame) => frame.includes('stale-proj'))).toBe(true)

      mounted.input.pressArrow('down')
      await mounted.frame()
      mounted.input.pressEnter()

      expect(await born(mounted)).toBe(true)
      expect(mounted.bridge.created.map((made) => made.projectId)).toEqual(['proj-old'])
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('shows only No workspace and the hint when the account has no projects, and Esc restores the draft', async () => {
    const mounted = await mountUnborn({ app: bornThreadApp({ api: fakeProjectsApi({ projects: [] }), origin: null }) })

    try {
      await mounted.command('empty')

      expect(await mounted.frameHolds((frame) => frame.includes(NO_PROJECTS_HINT))).toBe(true)

      mounted.dismiss()

      expect(await draftIs(mounted, 'empty')).toBe(true)
      expect(mounted.bridge.created).toEqual([])
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('names the failure and restores the draft when the project list cannot be loaded', async () => {
    const api = fakeProjectsApi({ listFails: true })
    const mounted = await mountUnborn({ app: bornThreadApp({ api }) })

    try {
      await mounted.command('offline')

      expect(await noticeNaming('could not load your projects')).toBe(true)
      expect(await draftIs(mounted, 'offline')).toBe(true)
      expect(mounted.bridge.created).toEqual([])
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('washes the project row under the pointer', async () => {
    const mounted = await mountUnborn({ app: bornThreadApp({ api: fakeProjectsApi({ projects: OTHER }), origin: null }) })

    try {
      await mounted.command('hover')
      expect(await mounted.frameHolds((frame) => frame.includes('stale-proj'))).toBe(true)

      const lines = (await mounted.frame()).split('\n')
      const row = lines.findIndex((line) => line.includes('stale-proj'))
      const column = lines[row]?.indexOf('stale-proj') ?? -1
      expect(row).toBeGreaterThan(0)

      const groundAt = (): unknown => {
        const painted = mounted.paintedLines() as unknown as { lines: ({ spans: { text: string; bg: { equals: (other: unknown) => boolean } }[] } | undefined)[] }
        let at = 0
        for (const span of painted.lines[row]?.spans ?? []) {
          const width = [...span.text].length
          if (column < at + width) return span.bg.equals(parseColor(theme.hoverBg))
          at += width
        }
        return undefined
      }
      expect(groundAt()).toBe(false)

      await mounted.mouse.moveTo(column, row)
      await mounted.frame()

      expect(groundAt()).toBe(true)
    } finally {
      await mounted.done()
    }
  }, 60_000)
})
