import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it, mock } from 'bun:test'
import React from 'react'

import {
  MODEL_WAIT_PARTIAL_NOTE,
  modelWaitViewOf,
  OLD_SERVE_CONTROLS,
  RECHECK_CHARGE_WARNING,
  controlOutcomeNoteOf,
  type RunAttention,
} from '@dltech/atlas-client/transcript'
import {
  EAvailabilityControlResult,
  EModelWaitCause,
  EProviderFailureKind,
  EWaitEpisodeKind,
  toAccountId,
  toThreadId,
  type WaitingForModel,
} from '@dltech/atlas-core'

import { FAILED_WITH_A_REASON, FINISHED, HEIGHT, NOW, CWD } from './transcript-fixture'
import { Transcript } from '../components/transcript'
import { teardown } from '../markdown/__tests__/harness'
import type { ModelWaitControlState } from '../model-wait-view'

const key = { accountId: toAccountId('acct-1'), providerId: 'anthropic', modelId: 'claude-x' }
const LONG = 'A-very-long-account-name-that-must-not-be-clipped-1234567890'
const waiting = (overrides: Partial<WaitingForModel> = {}): WaitingForModel => ({
  episode: { kind: EWaitEpisodeKind.Credential, key, generation: 3 },
  cause: EModelWaitCause.Availability,
  providerId: 'anthropic',
  accountId: 'acct-1',
  modelId: 'claude-x',
  reason: EProviderFailureKind.Quota,
  resetAt: null,
  affectedThreadIds: [toThreadId('root'), toThreadId('child-1')],
  ...overrides,
})

const attentionOf = (waits: readonly WaitingForModel[], label = LONG): RunAttention => {
  const view = modelWaitViewOf({ events: [], live: waits, accountLabelOf: () => label })
  if (view === null) throw new Error('fixture')
  return {
    failure: null,
    message: view.title,
    failureSeq: null,
    runId: null,
    remedies: [],
    dismissible: false,
    busyReason: null,
    modelWait: view,
  }
}

const controlOf = (overrides: Partial<ModelWaitControlState> = {}): ModelWaitControlState => ({
  enabled: true,
  disabledReason: undefined,
  pending: null,
  notes: new Map(),
  labelOfThread: (id) => (id === 'root' ? 'This session' : `agent ${id}`),
  onAction: () => undefined,
  ...overrides,
})

const flat = (frame: string): string =>
  frame
    .replaceAll('┃', ' ')
    .replace(/ +/g, ' ')
    .replace(/ ?\n ?/g, ' ')

async function rawFrameOf(args: {
  attention: RunAttention
  control: ModelWaitControlState
  width?: number
}): Promise<string> {
  const width = args.width ?? 100
  const setup = await testRender(
    <box flexDirection="column" width={width} height={HEIGHT}>
      <Transcript
        model={FAILED_WITH_A_REASON}
        width={width}
        now={NOW}
        cwd={CWD}
        turn={FINISHED}
        attention={args.attention}
        modelWait={args.control}
      />
    </box>,
    { width, height: HEIGHT },
  )
  await setup.flush()
  try {
    return setup.captureCharFrame()
  } finally {
    teardown(setup)
  }
}

const frameOf = async (args: Parameters<typeof rawFrameOf>[0]): Promise<string> =>
  flat(await rawFrameOf(args))

describe('the waiting-for-model block', () => {
  it('supersedes the stale failed block and names provider, account, reason, reset and affected', async () => {
    const frame = await frameOf({ attention: attentionOf([waiting()]), control: controlOf() })
    expect(frame).toContain('Waiting for model')
    expect(frame).not.toContain('overloaded_error')
    expect(frame).toContain('Anthropic')
    expect(frame).toContain('allowance exhausted')
    expect(frame).toContain('Provider reset: not supplied.')
    expect(frame).toContain('2 sessions waiting')
    expect(frame).toContain('This session')
    expect(frame).toContain('Recheck access')
    expect(frame).toContain('providers: ctrl+a')
  })

  it('offers Remove manual pause first for a paused account', async () => {
    const frame = await frameOf({
      attention: attentionOf([waiting({ reason: null })]),
      control: controlOf(),
    })
    expect(frame).toContain('Remove manual pause')
    expect(frame).not.toContain('Recheck access')
  })

  it('says no sessions are waiting for an empty affected list', async () => {
    const frame = await frameOf({
      attention: attentionOf([waiting({ affectedThreadIds: [] })]),
      control: controlOf(),
    })
    expect(frame).toContain('No sessions currently waiting')
  })

  it('shows the update hint and no live action for an old serve', async () => {
    const frame = await frameOf({
      attention: attentionOf([waiting()]),
      control: controlOf({ enabled: false, disabledReason: OLD_SERVE_CONTROLS }),
    })
    expect(frame).toContain(OLD_SERVE_CONTROLS)
  })

  it('shows the action error and keeps the issue', async () => {
    const attention = attentionOf([waiting()])
    const issueKey = attention.modelWait?.issues[0]?.key ?? 'missing'
    const frame = await frameOf({
      attention,
      control: controlOf({
        notes: new Map([[issueKey, controlOutcomeNoteOf(EAvailabilityControlResult.Unreachable)]]),
      }),
    })
    expect(frame).toContain('Could not reach the provider')
    expect(frame).toContain('allowance exhausted')
  })

  it('shows inline pending text on the pending action only', async () => {
    const attention = attentionOf([waiting()])
    const issue = attention.modelWait?.issues[0]
    const frame = await frameOf({
      attention,
      control: controlOf({
        pending: { key: issue?.key ?? '', action: issue?.actions[0]?.action ?? ('x' as never) },
      }),
    })
    expect(frame).toContain('Rechecking…')
  })

  it('marks a snapshot-only view as possibly incomplete', async () => {
    const view = modelWaitViewOf({ events: [], snapshot: waiting() })
    if (view === null) throw new Error('fixture')
    const attention = { ...attentionOf([waiting()]), modelWait: view }
    const frame = await frameOf({ attention, control: controlOf() })
    expect(frame).toContain(MODEL_WAIT_PARTIAL_NOTE.slice(0, 30))
  })

  for (const width of [40, 60]) {
    it(`wraps the account identity and reason without clipping at ${width} columns`, async () => {
      const frame = await rawFrameOf({
        attention: attentionOf([waiting()]),
        control: controlOf(),
        width,
      })
      const squeezed = frame.replace(/[\s┃]+/g, '')
      expect(squeezed).toContain(LONG)
      expect(squeezed).toContain('allowanceexhausted')
      expect(squeezed).toContain('Recheckaccess')
      for (const line of frame.split('\n')) expect(line.length).toBeLessThanOrEqual(width)
    })
  }

  it('asks to confirm charges before a Recheck runs', async () => {
    const onAction = mock(() => undefined)
    const attention = attentionOf([waiting()])
    const setup = await testRender(
      <box flexDirection="column" width={100} height={HEIGHT}>
        <Transcript
          model={FAILED_WITH_A_REASON}
          width={100}
          now={NOW}
          cwd={CWD}
          turn={FINISHED}
          attention={attention}
          modelWait={controlOf({ onAction })}
        />
      </box>,
      { width: 100, height: HEIGHT },
    )
    await setup.flush()
    try {
      const clickText = async (text: string) => {
        const lines = setup.captureCharFrame().split('\n')
        const y = lines.findIndex((line) => line.includes(text))
        expect(y).toBeGreaterThanOrEqual(0)
        await setup.mockMouse.click((lines[y] ?? '').indexOf(text) + 1, y)
        await setup.flush()
      }
      await clickText('Recheck access')
      expect(onAction).not.toHaveBeenCalled()
      expect(setup.captureCharFrame().replace(/[\s┃]+/g, '')).toContain(
        RECHECK_CHARGE_WARNING.replace(/\s+/g, '').slice(0, 40),
      )
      await clickText('Recheck and continue')
      expect(onAction).toHaveBeenCalledTimes(1)
    } finally {
      teardown(setup)
    }
  })
})
