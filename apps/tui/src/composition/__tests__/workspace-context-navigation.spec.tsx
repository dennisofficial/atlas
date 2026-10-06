import { describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import React, { act } from 'react'
import { testRender } from '@opentui/react/test-utils'
import { toThreadId } from '@dltech/atlas-core'
import { contextDirectory, createSessionContextReader, sessionDirectory } from '@dltech/atlas-harness'

import { ContextSection } from '../../ui/components/sidebar/context'
import { teardown } from '../../ui/markdown/__tests__/harness'
import { installLinkClickOpen } from '../link-click'
import type { ContextControl } from '../use-context'
import { useWorkspaceContext, WorkspaceContextPane } from '../workspace-context'

const settle = async () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)) })

describe('workspace context navigation on disk', () => {
  it('follows context links through a collapsed folder and restores folder choices after remount', async () => {
    const scratch = process.env.ATLAS_SESSION_DIR === undefined
      ? process.env.TMPDIR ?? '/tmp' : join(process.env.ATLAS_SESSION_DIR, 'scratch')
    await mkdir(scratch, { recursive: true })
    const home = await mkdtemp(join(scratch, 'context-navigation-'))
    const previous = process.env.ATLAS_HOME
    process.env.ATLAS_HOME = home
    const threadId = toThreadId(`context-navigation-${Date.now()}`)
    const sessionDir = sessionDirectory({ home, sessionId: threadId })
    const root = contextDirectory({ sessionDir })
    await mkdir(join(root, 'sections'), { recursive: true })
    await writeFile(join(root, 'plan.md'), '# Context navigation\n\n[Read section](sections/intro.md)\n\n[Missing file](sections/missing.md)')
    await writeFile(join(root, 'sections', 'intro.md'), '# Section details\n\n[Back to plan](../plan.md)')
    const readers = createSessionContextReader({ home, threadId })
    const held: { current: ContextControl | null } = { current: null }
    const onClosePeek = () => {}
    const Probe = () => {
      const control = useWorkspaceContext({ readers, threadId, onClosePeek })
      held.current = control
      return <box flexDirection="row" width={110} height={24}>
        <box width={78} flexDirection="column"><WorkspaceContextPane control={control} width={78} /></box>
        <box width={32} flexDirection="column"><ContextSection rows={control.tree.rows}
          levels={control.tree.levels} opened={control.tree.opened} loading={control.tree.loading}
          cells={32} onActivate={control.tree.handleActivate} /></box>
      </box>
    }
    let setup = await testRender(<Probe />, { width: 110, height: 24 })
    const opened: string[] = []
    const install = () => installLinkClickOpen({ renderer: setup.renderer,
      openUrl: (url) => opened.push(url), openFile: ({ path }) => opened.push(path) })
    const frame = async () => { await setup.flush(); return setup.captureCharFrame() }
    const click = async (label: string) => {
      const lines = (await frame()).split('\n')
      const y = lines.findIndex((line) => line.includes(label))
      expect(y).toBeGreaterThanOrEqual(0)
      await act(async () => { await setup.mockMouse.click((lines[y] ?? '').indexOf(label) + 1, y) })
      await settle()
      await setup.flush()
    }
    install()
    try {
      await settle()
      await settle()
      expect(held.current?.tree.rows.map((row) => row.path)).toContain('sections/intro.md')
      await click('sections')
      expect(held.current?.tree.rows.map((row) => row.path)).not.toContain('sections/intro.md')
      await click('plan.md')
      expect(await frame()).toContain('Context navigation')
      await click('Read section')
      expect(held.current?.viewer?.path).toBe('sections/intro.md')
      expect(await frame()).toContain('Section details')
      expect(held.current?.tree.rows.map((row) => row.path)).not.toContain('sections/intro.md')
      const preview = process.env.ATLAS_CONTEXT_PREVIEW
      if (preview !== undefined) {
        await writeFile(preview, await frame())
        await writeFile(`${preview}.json`, JSON.stringify(setup.captureSpans(), null, 2))
      }
      await click('Back to plan')
      expect(held.current?.viewer?.path).toBe('plan.md')
      await click('Missing file')
      expect(await frame()).toContain('missing or outside')
      expect(opened).toEqual([])
      await teardown(setup)
      setup = await testRender(<Probe />, { width: 110, height: 24 })
      install()
      await settle()
      await settle()
      expect(held.current?.tree.rows.map((row) => row.path)).not.toContain('sections/intro.md')
      expect(JSON.parse(await readFile(join(sessionDir, 'context-folders.json'), 'utf8'))).toEqual({ closed: ['sections'] })
      await click('sections')
      expect(held.current?.tree.rows.map((row) => row.path)).toContain('sections/intro.md')
    } finally {
      await teardown(setup)
      if (previous === undefined) delete process.env.ATLAS_HOME
      else process.env.ATLAS_HOME = previous
      await rm(home, { recursive: true, force: true })
    }
  })
})
