import { ESettingId } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'
import { teardown } from '../../ui/markdown/__tests__/harness'
import { appWith, widthOf, columnOf, landed, opened, onSettings, valueOf, SIDEBAR_WIDTH_ROW, DECISIONS_URL_ROW, downTo } from './app-settings-fixture'

describe('the settings page', () => {
  it('stays closed until ctrl+o asks for it, and leaves on escape', async () => {
    const setup = await opened(appWith())

    try {
      expect(setup.captureCharFrame()).not.toContain('TRANSCRIPT')

      setup.mockInput.pressKey('o', { ctrl: true })
      await landed(setup)
      expect(setup.captureCharFrame()).toContain('TRANSCRIPT')

      setup.mockInput.pressEscape()
      await landed(setup)
      expect(setup.captureCharFrame()).not.toContain('TRANSCRIPT')
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('toggles the row under the cursor on ⏎ and saves it', async () => {
    const app = appWith()
    const setup = await onSettings(app)

    try {
      expect(valueOf(app, ESettingId.SmoothStreaming)).toBe(true)

      setup.mockInput.pressEnter()
      await landed(setup)

      expect(valueOf(app, ESettingId.SmoothStreaming)).toBe(false)
      expect(app.settings.snapshot().document.values[ESettingId.SmoothStreaming]).toBe(false)
      expect(setup.captureCharFrame()).toContain('off')
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('walks a range with the arrows without leaving its bounds', async () => {
    const app = appWith()
    const setup = await onSettings(app)

    try {
      await downTo({ setup, row: SIDEBAR_WIDTH_ROW })

      setup.mockInput.pressArrow('right')
      await landed(setup)
      expect(valueOf(app, ESettingId.SidebarWidth)).toBe(44)

      for (let step = 0; step < 12; step += 1) {
        setup.mockInput.pressArrow('right')
        await landed(setup)
      }

      expect(valueOf(app, ESettingId.SidebarWidth)).toBe(64)
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('walks the tab strip to another page', async () => {
    const setup = await onSettings(appWith())

    try {
      expect(setup.captureCharFrame()).not.toContain('COLOUR')

      setup.mockInput.pressTab()
      await landed(setup)
      expect(setup.captureCharFrame()).toContain('BACKGROUND PROCESSES')

      setup.mockInput.pressTab()
      await landed(setup)

      const frame = setup.captureCharFrame()
      expect(frame).toContain('COLOUR')
      expect(frame).toContain('Accent')
      expect(frame).toContain('COMPOSER')
      expect(frame).toContain('Composer edge')
      expect(frame).toContain('slab · bordered · claude')

      setup.mockInput.pressTab({ shift: true })
      await landed(setup)
      expect(setup.captureCharFrame()).toContain('BACKGROUND PROCESSES')

      setup.mockInput.pressTab({ shift: true })
      await landed(setup)
      expect(setup.captureCharFrame()).toContain('TRANSCRIPT')
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('applies a saved setting to the app it came from', async () => {
    const app = appWith()
    const setup = await onSettings(app)

    try {
      await downTo({ setup, row: SIDEBAR_WIDTH_ROW })
      setup.mockInput.pressArrow('left')
      await landed(setup)

      setup.mockInput.pressEscape()
      await landed(setup)

      expect(valueOf(app, ESettingId.SidebarWidth)).toBe(40)
      expect(setup.captureCharFrame()).not.toContain('TRANSCRIPT')
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('resizes the explanation pane as the width changes under the cursor', async () => {
    const app = appWith()
    const setup = await onSettings(app)

    try {
      await downTo({ setup, row: SIDEBAR_WIDTH_ROW })
      const before = columnOf(setup, 'SET BY')
      expect(before).toBeGreaterThan(0)

      setup.mockInput.pressArrow('right')
      await landed(setup)

      expect(valueOf(app, ESettingId.SidebarWidth)).toBe(44)
      expect(columnOf(setup, 'SET BY')).toBe(before - 2)
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('gives the model picker the same width every other side pane gets', async () => {
    const columns: number[] = []

    for (const sidebarWidth of [42, 56]) {
      const setup = await opened(appWith(widthOf(sidebarWidth)))
      try {
        setup.mockInput.pressKey('p', { ctrl: true })
        await landed(setup)
        columns.push(columnOf(setup, 'MODEL'))
      } finally {
        await teardown(setup)
      }
    }

    expect(columns[0]).toBeGreaterThan(0)
    expect((columns[0] ?? 0) - (columns[1] ?? 0)).toBe(14)
  }, 60_000)

  it('edits a text row in place and saves it', async () => {
    const app = appWith()
    const setup = await onSettings(app)

    try {
      await downTo({ setup, row: DECISIONS_URL_ROW })

      setup.mockInput.pressEnter()
      await landed(setup)
      expect(setup.captureCharFrame()).toContain('DECISION MODEL')

      await setup.mockInput.typeText('https://api.typesafe.ai/v1/systemone')
      await landed(setup)

      setup.mockInput.pressEnter()
      await landed(setup)

      expect(valueOf(app, ESettingId.DecisionsUrl)).toBe('https://api.typesafe.ai/v1/systemone')
      expect(app.settings.snapshot().document.values[ESettingId.DecisionsUrl]).toBe(
        'https://api.typesafe.ai/v1/systemone',
      )
      expect(setup.captureCharFrame()).toContain('https://api.typesafe.ai/v1/systemone')
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('opens a text row holding its current value, and clears the row on backspace', async () => {
    const app = appWith({ values: { [ESettingId.DecisionsUrl]: 'https://jev.example/v1' } })
    const setup = await onSettings(app)

    try {
      await downTo({ setup, row: DECISIONS_URL_ROW })

      setup.mockInput.pressEnter()
      await landed(setup)
      expect(setup.captureCharFrame()).toContain('https://jev.example/v1')

      setup.mockInput.pressEscape()
      await landed(setup)

      setup.mockInput.pressBackspace()
      await landed(setup)

      expect(valueOf(app, ESettingId.DecisionsUrl)).toBe('')
      expect(app.settings.snapshot().document.values[ESettingId.DecisionsUrl]).toBeUndefined()
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('keeps the keys to itself while it is open', async () => {
    const app = appWith()
    const setup = await onSettings(app)

    try {
      await setup.mockInput.typeText('hello')
      await landed(setup)

      expect(setup.captureCharFrame()).not.toContain('hello')
    } finally {
      await teardown(setup)
    }
  }, 60_000)
})
