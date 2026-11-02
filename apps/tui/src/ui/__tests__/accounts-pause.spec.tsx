import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it, mock } from 'bun:test'
import React from 'react'

import {
  EModelWaitCause,
  EAccountOrigin,
  EAccountStatus,
  EAuthKind,
  EAuthProvider,
  EProviderFailureKind,
  EWaitEpisodeKind,
  toAccountId,
  toThreadId,
  type Account,
  type WaitingForModel,
} from '@dltech/atlas-core'

import {
  EAccountsView,
  EProviderAction,
  openAccounts,
  openActions,
  providerActions,
  providerRows,
  selectedRow,
} from '../accounts-model'
import { askForPause } from '../accounts-pause-model'
import { Accounts } from '../components/accounts'
import { teardown } from '../markdown/__tests__/harness'

const NOW_ISO = '2026-11-02T10:00:00.000Z'
const account: Account = {
  id: toAccountId('acct-1'),
  provider: EAuthProvider.Anthropic,
  kind: EAuthKind.ApiKey,
  origin: EAccountOrigin.Login,
  label: 'Work account',
  status: EAccountStatus.Active,
  createdAt: NOW_ISO,
  updatedAt: NOW_ISO,
}
const key = { accountId: account.id, providerId: 'anthropic', modelId: 'claude-x' }
const waiting = (reason: EProviderFailureKind | null): WaitingForModel => ({
  episode: { kind: EWaitEpisodeKind.Credential, key, generation: 2 },
  cause: EModelWaitCause.Availability,
  providerId: 'anthropic',
  accountId: account.id,
  modelId: 'claude-x',
  reason,
  resetAt: null,
  affectedThreadIds: [toThreadId('a'), toThreadId('b')],
})

const rowsOf = (wait?: WaitingForModel) =>
  providerRows({
    accounts: [account],
    active: { [EAuthProvider.Anthropic]: account.id },
    waiting: wait === undefined ? undefined : [wait],
  })

async function render(state: ReturnType<typeof openAccounts>, onConfirm?: () => void) {
  const width = 100
  const setup = await testRender(
    <box flexDirection="column" width={width} height={30}>
      <box flexGrow={1} />
      <Accounts
        width={width}
        state={state}
        overlay
        onPick={() => undefined}
        onChooseAction={() => undefined}
        onChooseLogin={() => undefined}
        onDismiss={() => undefined}
        onOpenUrl={() => undefined}
        {...(onConfirm === undefined ? {} : { onConfirmPause: onConfirm })}
        onCancelPause={() => undefined}
      />
    </box>,
    { width, height: 30 },
  )
  await setup.flush()
  return setup
}

describe('TUI account availability controls', () => {
  it('offers no pause action for a healthy idle account', () => {
    expect(providerActions(rowsOf()[0] ?? (undefined as never))).not.toContain(
      EProviderAction.PauseAccount,
    )
  })

  it('offers Pause for an exhausted account and Remove manual pause for a paused one', () => {
    const exhausted = rowsOf(waiting(EProviderFailureKind.Quota))[0]
    const paused = rowsOf(waiting(null))[0]
    expect(providerActions(exhausted as never)).toContain(EProviderAction.PauseAccount)
    expect(providerActions(paused as never)).toContain(EProviderAction.RemoveManualPause)
    expect(providerActions(paused as never)).not.toContain(EProviderAction.PauseAccount)
  })

  it('shows Connected and a separate exhausted status', async () => {
    const setup = await render(openAccounts({ rows: rowsOf(waiting(EProviderFailureKind.Quota)) }))
    try {
      const frame = setup.captureCharFrame()
      expect(frame).toContain('connected')
      expect(frame).toContain('Allowance exhausted')
    } finally {
      teardown(setup)
    }
  })

  it('shows Paused by you separately from Connected', async () => {
    const setup = await render(openAccounts({ rows: rowsOf(waiting(null)) }))
    try {
      expect(setup.captureCharFrame()).toContain('Paused by you')
    } finally {
      teardown(setup)
    }
  })

  it('confirms the pause naming the account and the affected count, and runs on click', async () => {
    const onConfirm = mock(() => undefined)
    const opened = openActions(openAccounts({ rows: rowsOf(waiting(EProviderFailureKind.Quota)) }))
    const state = askForPause(opened)
    expect(state.view).toBe(EAccountsView.ConfirmPause)
    expect(selectedRow(state)).toBeDefined()
    const setup = await render(state, onConfirm)
    try {
      const frame = setup.captureCharFrame()
      expect(frame).toContain('Pause Work account?')
      expect(frame).toContain('New model requests on Work account stop.')
      expect(frame).toContain('sessions are using it.')
      expect(frame).toContain('Work already in flight')
      const lines = frame.split('\n')
      const y = lines.findIndex((line) => line.includes('Pause account'))
      await setup.mockMouse.click((lines[y] ?? '').indexOf('Pause account') + 1, y)
      await setup.flush()
      expect(onConfirm).toHaveBeenCalledTimes(1)
    } finally {
      teardown(setup)
    }
  })
})
