import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'bun:test'
import React, { act } from 'react'
import { contextDirectory, sessionDirectory } from '@dltech/atlas-harness'

import { grammarsReady, teardown } from '../../ui/markdown/__tests__/harness'
import { App } from '../app'
import { editorIn, spokenIn, THREAD } from './app-fixture'
import { fakeApp, scriptedModelPort } from './fake-app'

await grammarsReady()

describe('context pane in a conversation', () => {
  it('replaces transcript and composer, scrolls with bare arrows, then restores the draft', async () => {
    const previous = process.env.ATLAS_HOME
    const home = await mkdtemp(join(tmpdir(), 'atlas-tui-context-'))
    process.env.ATLAS_HOME = home
    const root = contextDirectory({ sessionDir: sessionDirectory({ home, sessionId: THREAD }) })
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'plan.ts'), Array.from({ length: 100 }, (_, index) => `const item${index + 1} = ${index + 1}`).join('\n'))
    const app = fakeApp({ model: scriptedModelPort({ script: { thinking: '', reply: 'done' } }) })
    const opened = await spokenIn(app)
    const setup = await testRender(<App app={app} opened={opened} />, { width: 140, height: 38 })
    try {
      await setup.flush()
      await act(async () => { await setup.mockInput.typeText('keep my draft') })
      await setup.flush()
      expect(setup.captureCharFrame()).toContain('what is in here?')
      expect(editorIn(setup.renderer.root)?.plainText).toBe('keep my draft')
      const rows = setup.captureCharFrame().split('\n')
      const row = rows.findIndex((line) => line.includes('plan.ts'))
      const column = (rows[row] ?? '').indexOf('plan.ts')
      expect(row).toBeGreaterThanOrEqual(0)
      await act(async () => { await setup.mockMouse.click(column, row) })
      await setup.flush()
      const viewer = setup.captureCharFrame()
      expect(viewer).toContain('const item1 = 1')
      expect(viewer.split('\n').map((line) => line.slice(0, 96)).join('\n')).not.toContain('what is in here?')
      expect(viewer).not.toContain('keep my draft')
      expect(editorIn(setup.renderer.root)?.plainText).toBe('keep my draft')
      await act(async () => { await setup.mockInput.typeText('do not type this') })
      expect(editorIn(setup.renderer.root)?.plainText).toBe('keep my draft')
      await act(async () => { setup.mockInput.pressArrow('down') })
      await setup.flush()
      expect(setup.captureCharFrame()).not.toContain('const item1 = 1')
      await act(async () => {
        setup.mockInput.pressEscape()
        await new Promise((resolve) => setTimeout(resolve, 60))
      })
      await setup.flush()
      expect(setup.captureCharFrame()).toContain('what is in here?')
      expect(setup.captureCharFrame()).toContain('keep my draft')
    } finally {
      await teardown(setup)
      await app.close()
      if (previous === undefined) delete process.env.ATLAS_HOME
      else process.env.ATLAS_HOME = previous
      await rm(home, { recursive: true, force: true })
    }
  }, 30000)
})
