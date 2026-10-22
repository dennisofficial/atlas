import { EPublishKind, EPublishStatus, type PlanRow } from '@dltech/atlas-harness'
import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'vitest'
import React from 'react'

import { EPickerOutcome, type PickerOutcome } from '../push-picker-model'
import { PushPicker } from '../push-picker'
import { settle, teardown } from '../../ui/markdown/__tests__/harness'

const row = (args: {
  id: string
  kind: EPublishKind
  label: string
  bytes: number
  status: EPublishStatus
  selected: boolean
}): PlanRow => ({
  item: {
    id: args.id,
    kind: args.kind,
    label: args.label,
    files: [],
    bytes: args.bytes,
    hash: args.id,
  },
  status: args.status,
  selected: args.selected,
})

const ROWS: readonly PlanRow[] = [
  row({
    id: 'skill:.agents/alpha',
    kind: EPublishKind.Skill,
    label: '.agents/alpha',
    bytes: 120_000,
    status: EPublishStatus.New,
    selected: true,
  }),
  row({
    id: 'skill:.agents/beta',
    kind: EPublishKind.Skill,
    label: '.agents/beta',
    bytes: 2_400_000,
    status: EPublishStatus.Changed,
    selected: false,
  }),
  row({
    id: 'skill:.claude/gamma',
    kind: EPublishKind.Skill,
    label: '.claude/gamma',
    bytes: 900,
    status: EPublishStatus.Unchanged,
    selected: true,
  }),
  row({
    id: 'instructions:ATLAS.md',
    kind: EPublishKind.Instructions,
    label: 'ATLAS.md',
    bytes: 3_100,
    status: EPublishStatus.Changed,
    selected: true,
  }),
  row({
    id: 'mcp',
    kind: EPublishKind.Mcp,
    label: 'mcp.json',
    bytes: 400,
    status: EPublishStatus.Unchanged,
    selected: false,
  }),
]

const READ_MS = 60

type Mounted = Awaited<ReturnType<typeof testRender>>

async function mount(): Promise<{ setup: Mounted; outcomes: PickerOutcome[] }> {
  const outcomes: PickerOutcome[] = []
  const setup = await testRender(
    <PushPicker rows={ROWS} onDone={(outcome) => outcomes.push(outcome)} />,
    { width: 90, height: 24 },
  )
  await setup.flush()
  return { setup, outcomes }
}

async function landed(setup: Mounted): Promise<void> {
  await settle(READ_MS)
  await setup.flush()
}

describe('push picker', () => {
  it('shows only new and changed rows by default and counts what it hid', async () => {
    const { setup } = await mount()
    try {
      const frame = setup.captureCharFrame()
      expect(frame).toContain('atlas push')
      expect(frame).toContain('.agents/alpha')
      expect(frame).toContain('.agents/beta')
      expect(frame).toContain('ATLAS.md')
      expect(frame).not.toContain('.claude/gamma')
      expect(frame).not.toContain('mcp.json')
      expect(frame).toContain('2 unchanged carried over')
      expect(frame).toContain('3 selected')
    } finally {
      await teardown(setup)
    }
  })

  it('toggles the row under the cursor with space', async () => {
    const { setup } = await mount()
    try {
      setup.mockInput.pressKey(' ')
      await landed(setup)
      expect(setup.captureCharFrame()).toContain('2 selected')
      expect(setup.captureCharFrame()).toMatch(/\[ \] .agents\/alpha/)
    } finally {
      await teardown(setup)
    }
  })

  it('reveals unchanged rows with a', async () => {
    const { setup } = await mount()
    try {
      setup.mockInput.pressKey('a')
      await landed(setup)
      const frame = setup.captureCharFrame()
      expect(frame).toContain('.claude/gamma')
      expect(frame).toContain('mcp.json')
      expect(frame).toContain('showing all 5 items')
    } finally {
      await teardown(setup)
    }
  })

  it('turns every shown row on with A, then off, leaving hidden rows alone', async () => {
    const { setup, outcomes } = await mount()
    try {
      setup.mockInput.pressKey('A', { shift: true })
      await landed(setup)
      expect(setup.captureCharFrame()).toMatch(/\[x\] .agents\/beta/)
      expect(setup.captureCharFrame()).not.toContain('.claude/gamma')
      setup.mockInput.pressKey('A', { shift: true })
      await landed(setup)
      setup.mockInput.pressEnter()
      await landed(setup)
      expect(outcomes).toEqual([{ kind: EPickerOutcome.Chosen, ids: ['skill:.claude/gamma'] }])
    } finally {
      await teardown(setup)
    }
  })

  it('opens on every row when asked to show all', async () => {
    const outcomes: PickerOutcome[] = []
    const setup = await testRender(
      <PushPicker rows={ROWS} showAll onDone={(outcome) => outcomes.push(outcome)} />,
      { width: 90, height: 24 },
    )
    try {
      await setup.flush()
      expect(setup.captureCharFrame()).toContain('.claude/gamma')
      expect(setup.captureCharFrame()).toContain('showing all 5 items')
    } finally {
      await teardown(setup)
    }
  })

  it('resolves with the selected ids on enter', async () => {
    const { setup, outcomes } = await mount()
    try {
      setup.mockInput.pressKey('j')
      await landed(setup)
      setup.mockInput.pressKey(' ')
      await landed(setup)
      setup.mockInput.pressEnter()
      await landed(setup)
      expect(outcomes).toEqual([
        {
          kind: EPickerOutcome.Chosen,
          ids: [
            'skill:.agents/alpha',
            'skill:.agents/beta',
            'skill:.claude/gamma',
            'instructions:ATLAS.md',
          ],
        },
      ])
    } finally {
      await teardown(setup)
    }
  })

  it('cancels on escape', async () => {
    const { setup, outcomes } = await mount()
    try {
      setup.mockInput.pressEscape()
      await landed(setup)
      expect(outcomes).toEqual([{ kind: EPickerOutcome.Cancelled }])
    } finally {
      await teardown(setup)
    }
  })

  it('toggles a row when it is clicked', async () => {
    const { setup } = await mount()
    try {
      const lines = setup.captureCharFrame().split('\n')
      const y = lines.findIndex((line) => line.includes('.agents/beta'))
      await setup.mockMouse.click(10, y)
      await landed(setup)
      expect(setup.captureCharFrame()).toMatch(/\[x\] .agents\/beta/)
    } finally {
      await teardown(setup)
    }
  })

  it('draws every row with its size and status in words', async () => {
    const { setup } = await mount()
    try {
      setup.mockInput.pressKey('a')
      await landed(setup)
      const frame = setup.captureCharFrame()
      expect(frame).toMatch(/\[ \] \.agents\/beta\s+2\.4 MB\s+changed/)
      expect(frame).toMatch(/\[x\] \.claude\/gamma\s+900 B\s+unchanged/)
      process.stdout.write(frame)
    } finally {
      await teardown(setup)
    }
  })
})
