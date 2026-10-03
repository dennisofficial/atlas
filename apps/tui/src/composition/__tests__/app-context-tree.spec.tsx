import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'bun:test'
import React, { act } from 'react'
import { contextDirectory, sessionDirectory } from '@dltech/atlas-harness'

import { grammarsReady, teardown } from '../../ui/markdown/__tests__/harness'
import { App } from '../app'
import { editorIn, spokenIn, THREAD, until } from './app-fixture'
import { fakeApp, scriptedModelPort } from './fake-app'

await grammarsReady()

describe('the context tree in a conversation', () => {
  it('expands inline, navigates folders with keys, and isolates tree input from the draft', async () => {
    const previous = process.env.ATLAS_HOME
    const home = await mkdtemp(join(tmpdir(), 'atlas-context-tree-app-'))
    process.env.ATLAS_HOME = home
    const root = contextDirectory({ sessionDir: sessionDirectory({ home, sessionId: THREAD }) })
    await mkdir(join(root, 'notes', 'deep'), { recursive: true })
    await writeFile(join(root, 'plan.md'), 'root plan')
    await writeFile(join(root, 'notes', 'plan.md'), 'nested plan')
    await writeFile(join(root, 'notes', 'deep', 'decision.md'), 'deep decision')
    const app = fakeApp({ model: scriptedModelPort({ script: { thinking: '', reply: 'done' } }) })
    const setup = await testRender(<App app={app} opened={await spokenIn(app)} />, { width: 140, height: 38 })
    const frame = async () => { await setup.flush(); return setup.captureCharFrame() }
    const sidebar = async () => (await frame()).split('\n').map((line) => line.slice(98)).join('\n')
    const click = async (text: string) => {
      const lines = (await frame()).split('\n')
      const row = lines.findIndex((line) => line.includes(text))
      expect(row).toBeGreaterThanOrEqual(0)
      await act(async () => { await setup.mockMouse.click((lines[row] ?? '').indexOf(text), row) })
      await setup.flush()
    }
    const press = async (name: 'right' | 'left' | 'escape' | 'enter' | 'tab') => {
      await act(async () => {
        if (name === 'escape') { setup.mockInput.pressEscape(); await new Promise((resolve) => setTimeout(resolve, 60)) }
        else if (name === 'enter') setup.mockInput.pressEnter()
        else if (name === 'tab') setup.mockInput.pressTab()
        else setup.mockInput.pressArrow(name)
      })
      await setup.flush()
    }
    try {
      expect(await until({ holds: async () => (await sidebar()).includes('notes'), within: 5000 })).toBe(true)
      await act(async () => { await setup.mockInput.typeText('keep the draft') })
      await click('notes')
      expect(await until({ holds: async () => (await sidebar()).includes('deep'), within: 5000 })).toBe(true)
      expect((await sidebar()).split('\n').filter((line) => line.includes('plan.md'))).toHaveLength(2)
      expect(await sidebar()).not.toContain('.. / back')
      await act(async () => { await setup.mockInput.typeText('ignored by the focused tree') })
      expect(editorIn(setup.renderer.root)?.plainText).toBe('keep the draft')
      await click('notes')
      expect(await sidebar()).not.toContain('deep')
      expect((await sidebar()).split('\n').filter((line) => line.includes('plan.md'))).toHaveLength(1)
      await click('notes')
      expect(await until({ holds: async () => (await sidebar()).includes('deep'), within: 5000 })).toBe(true)
      await press('right')
      await press('right')
      expect(await until({ holds: async () => (await sidebar()).includes('decision.md'), within: 5000 })).toBe(true)
      await press('right')
      await press('enter')
      expect(await until({ holds: async () => (await frame()).includes('deep decision'), within: 5000 })).toBe(true)
      expect(await frame()).toContain('notes/deep/decision.md')
      await press('tab')
      await press('left')
      await press('left')
      expect(await sidebar()).not.toContain('decision.md')
      expect(await frame()).toContain('deep decision')
      await press('escape')
      expect(await frame()).toContain('deep decision')
      await press('escape')
      expect(await frame()).toContain('keep the draft')
      await writeFile(join(root, 'notes', 'new.md'), 'new file')
      expect(await until({ holds: async () => (await sidebar()).includes('new.md'), within: 5000 })).toBe(true)
      expect(await sidebar()).toContain('plan.md')
    } finally {
      await teardown(setup)
      await app.close()
      if (previous === undefined) delete process.env.ATLAS_HOME
      else process.env.ATLAS_HOME = previous
      await rm(home, { recursive: true, force: true })
    }
  }, 30000)
})
