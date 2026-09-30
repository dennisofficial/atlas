import { testRender } from '@opentui/react/test-utils'
import { afterAll, describe, expect, test } from 'bun:test'
import React from 'react'

import { EAuthor, EEntryKind, EPendingKind, type PendingRow, type TranscriptEntry } from '../../../../store'
import { teardown } from '../../../markdown/__tests__/harness'
import { EntryView } from '../../entry-view'
import { NoticeBlock } from '../notice-block'
import { PendingBlock } from '../pending-block'

type Setup = Awaited<ReturnType<typeof testRender>>

const mounted: Setup[] = []

afterAll(() => {
  for (const setup of mounted) setup.renderer.destroy()
})

const WIDE = { width: 100, height: 40 }

const REPORT = 'Everything is settled, nothing waits.'

const shellEndedEntry = (): TranscriptEntry => ({
  kind: EEntryKind.BackgroundShellEnded,
  author: EAuthor.Model,
  key: 'e1',
  text: 'Background shell "Run full TUI suite" completed (exit code 0)',
  shellId: 'bash_1',
  output: '',
  failed: false,
})

const pendingShellRow = (): PendingRow => ({
  kind: EPendingKind.BackgroundShell,
  id: 'shell-ended-bash_1',
  text: 'Background shell "Run full TUI suite" completed (exit code 0)',
  failed: false,
  body: null,
  entryKind: EEntryKind.BackgroundShellEnded,
})

async function shown(node: React.ReactNode): Promise<Setup> {
  const setup = await testRender(<box flexDirection="column">{node}</box>, WIDE)
  mounted.push(setup)
  await setup.flush()
  return setup
}

function dimmed(frame: ReturnType<Setup['captureSpans']>, text: string): boolean {
  for (const line of frame.lines) {
    for (const span of line.spans) {
      if (span.text.includes(text)) return (span.attributes & 2) !== 0
    }
  }
  throw new Error(`no span carried ${text}`)
}

describe('the durable and the pending notice are the same block', () => {
  test('the pending copy of a durable shell ending is its headline, dimmed and labelled queued', async () => {
    const durable = await shown(<EntryView entry={shellEndedEntry()} width={90} />)
    const pending = await shown(<PendingBlock rows={[pendingShellRow()]} width={90} />)

    const durableLine = durable.captureCharFrame().split('\n').find((row) => row.includes('exit code 0'))
    const pendingLine = pending.captureCharFrame().split('\n').find((row) => row.includes('exit code 0'))

    expect(durableLine?.replace(/\s+/g, '')).toContain('Backgroundshell')
    expect(pendingLine?.replace(/\s+/g, '')).toContain('Backgroundshell')
    expect(pendingLine).toContain('queued')
    expect(pendingLine).not.toContain('↵ output')

    expect(dimmed(pending.captureSpans(), 'exit code 0')).toBe(true)
    expect(dimmed(durable.captureSpans(), 'exit code 0')).toBe(false)
  })

  test('the pending variant answers to nothing: hovering leaves the headline alone', async () => {
    const setup = await shown(
      <NoticeBlock
        text='Background shell "Run full TUI suite" completed (exit code 0)'
        body="261 pass, 0 fail"
        failed={false}
        width={90}
        openHint="↵ output"
        pending
      />,
    )

    await setup.mockMouse.moveTo(4, 0)
    await setup.flush()

    expect(dimmed(setup.captureSpans(), 'exit code 0')).toBe(true)
  })

  test('a pending check-in keeps its semantics: still running, no failure mark, output semantics', async () => {
    const setup = await shown(
      <PendingBlock
        rows={[
          {
            kind: EPendingKind.BackgroundShell,
            id: 'shell-still-running-bash_1',
            text: 'Background shell "Run full TUI suite" is still running - a scheduled check-in, not an ending',
            failed: false,
            body: '261 pass so far',
            entryKind: EEntryKind.BackgroundShellStillRunning,
          } satisfies PendingRow,
        ]}
        width={90}
      />,
    )

    const frame = setup.captureCharFrame()
    expect(frame).toContain('still running - a scheduled check-in')
    expect(frame).toContain('261 pass so far')
    expect(frame).not.toContain('↵ output')
  })

  test('a pending watch match reads as progress with its matches in preview, not as a prompt', async () => {
    const setup = await shown(
      <PendingBlock
        rows={[
          {
            kind: EPendingKind.BackgroundShell,
            id: 'shell-matched-bash_1',
            text: 'Background shell "Run full TUI suite" matched its watch and is still running',
            failed: false,
            body: '12 fail\n13 fail',
            entryKind: EEntryKind.BackgroundShellMatched,
          } satisfies PendingRow,
        ]}
        width={90}
      />,
    )

    const frame = setup.captureCharFrame()
    expect(frame).toContain('matched its watch and is still running')
    expect(frame).toContain('12 fail')
    expect(frame).not.toContain('↵ matches')
  })

  test('a pending awaiting-input shell stays marked failed, because it cannot be answered', async () => {
    const setup = await shown(
      <PendingBlock
        rows={[
          {
            kind: EPendingKind.BackgroundShell,
            id: 'shell-awaiting-bash_1',
            text: 'Background shell "Run full TUI suite" is waiting on input and cannot be answered',
            failed: true,
            body: null,
            entryKind: EEntryKind.BackgroundShellAwaitingInput,
          } satisfies PendingRow,
        ]}
        width={90}
      />,
    )

    const frame = setup.captureCharFrame()
    expect(frame).toContain('is waiting on input and cannot be answered')
    expect(frame).not.toContain('↵ output')
  })

  test('a pending row whose body was never handed over claims nothing about it', async () => {
    const setup = await shown(<PendingBlock rows={[pendingShellRow()]} width={90} />)

    const frame = setup.captureCharFrame()
    expect(frame).not.toContain('printed nothing')
    expect(frame).not.toContain('nothing')
  })

  test('a long pending body previews its first lines and says there is more', async () => {
    const setup = await shown(
      <NoticeBlock
        text="Sub-agent explore reported"
        body={['one', 'two', 'three', 'four', 'five', 'six'].join('\n')}
        failed={false}
        width={90}
        openHint="↵ report"
        pending
      />,
    )

    const frame = setup.captureCharFrame()
    expect(frame).toContain('one')
    expect(frame).toContain('four')
    expect(frame).toContain('…')
    expect(frame).not.toContain('five')
  })

  test('a truly empty pending body still earns its silent note, because empty was handed over', async () => {
    const setup = await shown(
      <PendingBlock
        rows={[Object.assign(pendingShellRow(), { body: '' })]}
        width={90}
      />,
    )

    expect(setup.captureCharFrame()).toContain('printed nothing')
  })

  test('the durable block is untouched: a body still opens behind its hint', async () => {
    const setup = await shown(
      <NoticeBlock
        text="Sub-agent explore reported"
        body={REPORT}
        failed={false}
        width={90}
        openHint="↵ report"
      />,
    )

    const frame = setup.captureCharFrame()
    expect(frame).toContain('↵ report')
    expect(frame).not.toContain(REPORT)
    expect(frame).not.toContain('queued')
  })
})
