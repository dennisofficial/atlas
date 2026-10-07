import {
  agentTypeModelDefinitions,
  agentTypeSettingId,
  EDefinitionOrigin,
  ESettingsLayer,
  toThreadId,
} from '@dltech/atlas-core'
import { EMPTY_AGENT_TYPE_CATALOG } from '@dltech/atlas-harness'
import { TextAttributes } from '@opentui/core'
import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'bun:test'
import React from 'react'

import { grammarsReady, settle, teardown } from '../../ui/markdown/__tests__/harness'
import { App } from '../app'
import { fakeApp, scriptedModelPort, type FakeApp } from './fake-app'

await grammarsReady()

const THREAD = toThreadId('opened-thread')
const WIDE = { width: 150, height: 40 }
const NARROW = { width: 88, height: 40 }
const PROJECT_FILE = '/work/repo/.atlas/settings.json'
const READ_MS = 60

type Mounted = Awaited<ReturnType<typeof testRender>>

const reviewerId = agentTypeSettingId('reviewer')
const exploreId = agentTypeSettingId('explore')

const types = [
  { name: 'explore', origin: EDefinitionOrigin.BuiltIn },
  { name: 'reviewer', origin: EDefinitionOrigin.Project, definedIn: '/work/repo/.atlas/agents/reviewer.md' },
]

const appWith = (withProject = true): FakeApp => {
  const app = fakeApp({
    model: scriptedModelPort({ script: { thinking: 'weighing it', reply: 'done' } }),
    ...(withProject ? { projectSettings: { label: PROJECT_FILE } } : {}),
    agentTypes: {
      ...EMPTY_AGENT_TYPE_CATALOG,
      shadowed: [
        { name: 'explore', origin: EDefinitionOrigin.BuiltIn, definedIn: undefined, shadowedBy: EDefinitionOrigin.User },
      ],
    },
  })
  app.settings.register(agentTypeModelDefinitions({ types }))
  return app
}

async function landed(setup: Mounted): Promise<void> {
  await settle(READ_MS)
  await setup.flush()
}

async function onModels(app: FakeApp, size = WIDE): Promise<Mounted> {
  const setup = await testRender(
    <App app={app} opened={{ threadId: THREAD, events: [], turns: [], name: null, started: true }} />,
    size,
  )
  await setup.flush()
  await settle(250)
  await setup.flush()
  setup.mockInput.pressKey('o', { ctrl: true })
  await landed(setup)
  setup.mockInput.pressTab()
  await landed(setup)
  return setup
}

const lineWith = (setup: Mounted, needle: string): string =>
  setup.captureCharFrame().split('\n').find((line) => line.includes(needle)) ?? ''

async function downTo(args: { setup: Mounted; needle: string }): Promise<void> {
  for (let step = 0; step < 30; step += 1) {
    if (lineWith(args.setup, args.needle).includes('❯')) return
    args.setup.mockInput.pressArrow('down')
    await landed(args.setup)
  }
  throw new Error(`never reached ${args.needle}`)
}

const heldBy = (app: FakeApp, id: string) => app.settings.snapshot().resolution.settings.get(id)

describe('read-only overridden agent rows', () => {
  it('ignore return, backspace, left and right while staying selectable', async () => {
    const app = appWith()
    app.settings.set({ id: exploreId, value: 'anthropic/claude-haiku-4-5' })
    const before = JSON.stringify(app.settings.snapshot().document)
    const setup = await onModels(app)

    try {
      await downTo({ setup, needle: 'overridden' })
      expect(lineWith(setup, 'overridden')).not.toContain('choose')

      setup.mockInput.pressEnter()
      await landed(setup)
      setup.mockInput.pressBackspace()
      await landed(setup)
      setup.mockInput.pressArrow('left')
      await landed(setup)
      setup.mockInput.pressArrow('right')
      await landed(setup)

      const frame = setup.captureCharFrame()
      expect(frame).not.toContain('SEARCH')
      expect(lineWith(setup, 'overridden')).toContain('❯')
      expect(JSON.stringify(app.settings.snapshot().document)).toBe(before)
      expect(heldBy(app, exploreId)?.value).toBe('anthropic/claude-haiku-4-5')
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('select by click without touching the winning row', async () => {
    const app = appWith()
    app.settings.set({ id: exploreId, value: 'anthropic/claude-haiku-4-5' })
    const setup = await onModels(app)

    try {
      const frame = setup.captureCharFrame().split('\n')
      const row = frame.findIndex((line) => line.includes('overridden'))
      expect(row).toBeGreaterThan(0)

      await setup.mockMouse.click(Math.max(0, (frame[row] ?? '').indexOf('explore')), row)
      await landed(setup)

      expect(lineWith(setup, 'overridden')).toContain('❯')
      expect(heldBy(app, exploreId)?.value).toBe('anthropic/claude-haiku-4-5')
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('strike the label through and leave the active row plain', async () => {
    const setup = await onModels(appWith())

    try {
      const painted = setup.captureSpans() as unknown as {
        lines: ({ spans: { text: string; attributes: number }[] } | undefined)[]
      }
      const struck = (needle: string): boolean[] =>
        painted.lines
          .flatMap((line) => line?.spans ?? [])
          .filter((span) => span.text.includes(needle))
          .map((span) => (span.attributes & TextAttributes.STRIKETHROUGH) !== 0)

      expect(struck('explore agents')).toEqual([false, true])
      expect(struck('reviewer agents')).toEqual([false])
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('shows overridden and read only in the footer of a folded layout', async () => {
    const setup = await onModels(appWith(), NARROW)

    try {
      await downTo({ setup, needle: 'overridden' })
      expect(setup.captureCharFrame()).toContain('overridden · read only')
    } finally {
      await teardown(setup)
    }
  }, 60_000)
})

describe('repository agent model writes', () => {
  it('save the picked model to project settings and name that file', async () => {
    const app = appWith()
    const setup = await onModels(app)

    try {
      await downTo({ setup, needle: 'reviewer agents' })
      expect(setup.captureCharFrame()).toContain(`edits write to ${PROJECT_FILE}`)

      setup.mockInput.pressEnter()
      await landed(setup)
      setup.mockInput.pressEnter()
      await landed(setup)

      const held = heldBy(app, reviewerId)
      expect(held?.layer).toBe(ESettingsLayer.Project)
      expect(held?.origin).toBe(PROJECT_FILE)
      expect(app.settings.snapshot().document.values[reviewerId]).toBeUndefined()
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('say project settings are unavailable when the session has no project file', async () => {
    const app = appWith(false)
    const setup = await onModels(app, NARROW)

    try {
      await downTo({ setup, needle: 'reviewer agents' })

      const frame = setup.captureCharFrame()
      expect(frame).toContain('project settings unavailable')
      expect(frame).not.toContain('edits write to ~/.atlas/settings.json')
    } finally {
      await teardown(setup)
    }
  }, 60_000)
})
