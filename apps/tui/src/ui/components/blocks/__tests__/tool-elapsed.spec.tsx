import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'bun:test'
import React from 'react'

import { toCallId } from '@dltech/atlas-core'

import { ECallState, type ToolCall, type ToolRun } from '../../../../store'
import { letTimersRun } from '../../../__tests__/ticking'
import { frameShowing } from '../../../__tests__/waiting'
import { grammarsReady, teardown } from '../../../markdown/__tests__/harness'
import { durationLabelOf, elapsedCellsOf } from '../tool-elapsed'
import { ToolRunBlock } from '../tool-run-block'

await grammarsReady()

const WIDTH = 100

const HEIGHT = 30

const CWD = '/repo'

const QUIET_MS = 1_300

let ordinal = 0

const call = (args: {
  name: string
  input?: unknown
  output?: unknown
  state?: ECallState
  at?: string | null
  settledAt?: string | null
}): ToolCall => {
  ordinal += 1
  const state = args.state ?? ECallState.Ok
  return {
    callId: toCallId(`elapsed-${ordinal}`),
    name: args.name,
    input: args.input ?? {},
    output: args.output,
    modelText: '',
    state,
    note: null,
    at: args.at === undefined ? null : args.at,
    settledAt:
      args.settledAt === undefined
        ? state === ECallState.Pending
          ? null
          : '2026-08-29T00:00:00.000Z'
        : args.settledAt,
    attachments: [],
  }
}

const runOf = (calls: readonly ToolCall[]): ToolRun => ({
  key: `tools:${calls[0]?.callId ?? 'none'}`,
  openedBy: calls[0]?.callId ?? toCallId('none'),
  calls,
})

const bash = (args: {
  description: string
  state?: ECallState
  at?: string | null
  settledAt?: string | null
}): ToolCall =>
  call({
    name: 'bash',
    input: { command: 'bun run build', description: args.description },
    output:
      args.state === ECallState.Pending
        ? undefined
        : { command: 'bun run build', stdout: '', exitCode: 0 },
    ...(args.state === undefined ? {} : { state: args.state }),
    ...(args.at === undefined ? {} : { at: args.at }),
    ...(args.settledAt === undefined ? {} : { settledAt: args.settledAt }),
  })

const read = (path: string, state?: ECallState): ToolCall =>
  call({
    name: 'read',
    input: { path: `${CWD}/${path}` },
    output: state === ECallState.Pending ? undefined : { path: `${CWD}/${path}`, lines: 12 },
    ...(state === undefined ? {} : { state }),
  })

const elapsedIn = (frame: string): number | null => {
  const found = / {2}(\d+)s/.exec(frame)
  return found === null ? null : Number(found[1])
}

describe('the final duration of a settled call', () => {
  it('reads the stamps off the call rather than a clock', () => {
    const settledCall = call({
      name: 'bash',
      at: '2026-08-29T00:00:00.000Z',
      settledAt: '2026-08-29T00:03:04.000Z',
    })

    expect(durationLabelOf(settledCall)).toBe('3m 4s')
  })

  it('says nothing when the log kept no stamps for the call', () => {
    expect(durationLabelOf(call({ name: 'bash', at: null }))).toBeNull()
    expect(durationLabelOf(call({ name: 'bash', at: null, settledAt: null }))).toBeNull()
  })

  it('reserves the widest running reading so the ticking never reflows the row', () => {
    const running = bash({
      description: 'Build',
      state: ECallState.Pending,
      at: new Date().toISOString(),
    })
    const settledCall = call({
      name: 'bash',
      at: '2026-08-29T00:00:00.000Z',
      settledAt: '2026-08-29T00:00:12.000Z',
    })

    expect(elapsedCellsOf({ call: running, separator: '' })).toBeGreaterThanOrEqual(
      elapsedCellsOf({ call: settledCall, separator: '' }),
    )
    expect(elapsedCellsOf({ call: call({ name: 'bash' }), separator: ' · ' })).toBe(0)
  })
})

describe('a tool block with its call still running', () => {
  it('shows the elapsed time beside a lone running call and counts up each second', async () => {
    const running = bash({
      description: 'Build the workspace',
      state: ECallState.Pending,
      at: new Date().toISOString(),
    })
    const setup = await testRender(
      <box flexDirection="column" width={WIDTH} height={HEIGHT}>
        <ToolRunBlock run={runOf([running])} width={WIDTH} cwd={CWD} />
      </box>,
      { width: WIDTH, height: HEIGHT },
    )
    globalThis.IS_REACT_ACT_ENVIRONMENT = false
    try {
      const opened = await frameShowing({ setup, text: 'Build the workspace' })
      const first = elapsedIn(opened)
      expect(first).not.toBeNull()

      await letTimersRun({ setup, ms: 1_500 })

      const second = elapsedIn(setup.captureCharFrame())
      expect(second).not.toBeNull()
      expect(second ?? 0).toBeGreaterThan(first ?? 0)
    } finally {
      await teardown(setup)
    }
  }, 30_000)

  it('shows the running call’s elapsed beside the sentence it is gathering into', async () => {
    const running: ToolCall = { ...read('c.ts', ECallState.Pending), at: new Date().toISOString() }
    const setup = await testRender(
      <box flexDirection="column" width={WIDTH} height={HEIGHT}>
        <ToolRunBlock run={runOf([read('a.ts'), read('b.ts'), running])} width={WIDTH} cwd={CWD} />
      </box>,
      { width: WIDTH, height: HEIGHT },
    )
    globalThis.IS_REACT_ACT_ENVIRONMENT = false
    try {
      const frame = await frameShowing({ setup, text: 'Read 2 files' })
      expect(frame).toMatch(/· \d+s/)
    } finally {
      await teardown(setup)
    }
  }, 30_000)
})

describe('a tool block whose call has landed', () => {
  it('freezes the reading at the final duration beside the note', async () => {
    const landed = bash({
      description: 'Build the workspace',
      at: '2026-08-29T00:00:00.000Z',
      settledAt: '2026-08-29T00:03:04.000Z',
    })
    const setup = await testRender(
      <box flexDirection="column" width={WIDTH} height={HEIGHT}>
        <ToolRunBlock run={runOf([landed])} width={WIDTH} cwd={CWD} />
      </box>,
      { width: WIDTH, height: HEIGHT },
    )
    try {
      await setup.flush()
      const frame = setup.captureCharFrame()

      expect(frame).toContain('Build the workspace')
      expect(frame).toContain('3m 4s')
    } finally {
      await teardown(setup)
    }
  })

  it('keeps a call without stamps exactly as it was — no reading, no guess', async () => {
    const landed = bash({ description: 'Build the workspace' })
    const setup = await testRender(
      <box flexDirection="column" width={WIDTH} height={HEIGHT}>
        <ToolRunBlock run={runOf([landed])} width={WIDTH} cwd={CWD} />
      </box>,
      { width: WIDTH, height: HEIGHT },
    )
    try {
      await setup.flush()
      const frame = setup.captureCharFrame()

      expect(frame).toContain('Build the workspace')
      expect(frame).not.toMatch(/\d+s\b/)
    } finally {
      await teardown(setup)
    }
  })

  it('stops ticking once the duration is final — an idle block requests no frames', async () => {
    const landed = bash({
      description: 'Build the workspace',
      at: '2026-08-29T00:00:00.000Z',
      settledAt: '2026-08-29T00:00:12.000Z',
    })
    const setup = await testRender(
      <box flexDirection="column" width={WIDTH} height={HEIGHT}>
        <ToolRunBlock run={runOf([landed])} width={WIDTH} cwd={CWD} />
      </box>,
      { width: WIDTH, height: HEIGHT },
    )
    globalThis.IS_REACT_ACT_ENVIRONMENT = false
    try {
      await setup.flush()
      const before = setup.renderer.getStats().frameCount
      await new Promise((resolve) => setTimeout(resolve, QUIET_MS))
      await setup.flush()

      expect(setup.renderer.getStats().frameCount - before).toBe(0)
    } finally {
      await teardown(setup)
    }
  }, 30_000)
})
