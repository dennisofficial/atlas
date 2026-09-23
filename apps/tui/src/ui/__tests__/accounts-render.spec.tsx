import {
  EAccountOrigin,
  EAccountStatus,
  EAuthKind,
  EAuthProvider,
  EUsageWindow,
  toAccountId,
  type Account,
} from '@dltech/atlas-core'
import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'bun:test'
import React from 'react'

import { accountMeterSpans } from '../account-meters'
import {
  EAccountsView,
  EPickIntent,
  openAccounts,
  openActions,
  openLoginPicker,
  providerRows,
  type AccountsState,
  type ProviderRow,
} from '../accounts-model'
import { Accounts } from '../components/accounts'
import { teardown } from '../markdown/__tests__/harness'

const TERMINAL_WIDTH = 100

const HEIGHT = 30

const NOW = 1_700_000_000_000

const WARN = { [EUsageWindow.FiveHour]: 80, [EUsageWindow.SevenDay]: 80 }

const account = (args: {
  id: string
  label: string
  provider?: EAuthProvider
  kind?: EAuthKind
  origin?: EAccountOrigin
  status?: EAccountStatus
}): Account => ({
  id: toAccountId(args.id),
  provider: args.provider ?? EAuthProvider.Anthropic,
  kind: args.kind ?? EAuthKind.Oauth,
  origin: args.origin ?? EAccountOrigin.Login,
  label: args.label,
  status: args.status ?? EAccountStatus.Active,
  subscription: 'team',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

const IMPORTED = account({
  id: 'acc_imported',
  label: 'Claude Code (team)',
  origin: EAccountOrigin.Imported,
})

const LOGGED_IN = account({
  id: 'acc_login',
  label: 'dennis@trycomp.ai',
  origin: EAccountOrigin.Login,
})

const EXPIRED = account({
  id: 'acc_expired',
  label: 'dennis@trycomp.ai',
  origin: EAccountOrigin.Login,
  status: EAccountStatus.Expired,
})

const rowsOf = (accounts: readonly Account[]): readonly ProviderRow[] =>
  providerRows({ accounts, active: { [EAuthProvider.Anthropic]: accounts[0]?.id } })

const stateOn = (rows: readonly ProviderRow[], index = 0): AccountsState => ({
  ...openAccounts({ rows }),
  index,
})

const METERED = accountMeterSpans({
  usage: {
    [EUsageWindow.FiveHour]: { utilization: 72, resetsAt: new Date(NOW + 4_500_000).toISOString() },
    [EUsageWindow.SevenDay]: { utilization: 30, resetsAt: null },
  },
  warn: WARN,
  now: NOW,
})

async function render(args: {
  state: AccountsState
  meters?: (account: Account) => readonly (typeof METERED)[number][]
  width?: number
}): Promise<string[]> {
  const width = args.width ?? TERMINAL_WIDTH
  const setup = await testRender(
    <box flexDirection="column" width={width} height={HEIGHT}>
      <box flexGrow={1} />
      <Accounts
        width={width}
        state={args.state}
        overlay
        onPick={() => {}}
        onChooseAction={() => {}}
        onChooseLogin={() => {}}
        onDismiss={() => {}}
        onOpenUrl={() => {}}
        {...(args.meters === undefined ? {} : { meters: args.meters })}
      />
    </box>,
    { width, height: HEIGHT },
  )

  try {
    await setup.flush()
    return setup.captureCharFrame().split('\n')
  } finally {
    await teardown(setup)
  }
}

const lineWith = (rows: readonly string[], text: string): string =>
  rows.find((row) => row.includes(text)) ?? ''

describe('the provider list', () => {
  it('gives every provider a row, connected or not', async () => {
    const rows = await render({ state: stateOn(rowsOf([LOGGED_IN])) })
    const frame = rows.join('\n')

    expect(frame).toContain('Anthropic')
    expect(frame).toContain('OpenAI')
    expect(frame).toContain('OpenRouter')
    expect(frame).toContain('Inference.net')
  })

  it('marks the connected providers with a live dot', async () => {
    const rows = await render({ state: stateOn(rowsOf([LOGGED_IN])) })

    expect(lineWith(rows, 'Anthropic')).toContain('●')
    expect(lineWith(rows, 'OpenRouter')).toContain('○')
  })

  it('keeps GitHub out of the model provider list', async () => {
    const rows = await render({ state: stateOn(rowsOf([LOGGED_IN])) })

    expect(rows.join('\n')).not.toContain('GitHub')
  })
})

describe('the detail panel', () => {
  it('names the provider and its connection state', async () => {
    const rows = await render({ state: stateOn(rowsOf([LOGGED_IN])) })

    expect(lineWith(rows, 'connected')).toContain('Anthropic')
  })

  it('shows the active login under its own section', async () => {
    const rows = await render({ state: stateOn(rowsOf([LOGGED_IN, IMPORTED])) })

    expect(lineWith(rows, 'ACTIVE LOGIN')).not.toBe('')
    const active = lineWith(rows, 'dennis@trycomp.ai')
    expect(active).toContain('subscription')
  })

  it('files the rest under OTHER LOGINS with what is wrong with them', async () => {
    const rows = await render({ state: stateOn(rowsOf([LOGGED_IN, IMPORTED, EXPIRED])) })
    const frame = rows.join('\n')

    expect(frame).toContain('OTHER LOGINS')
    expect(frame).toContain('Claude Code (team)')
    expect(frame).toContain('expired')
  })

  it('renders the meter under the active login, with its tail intact', async () => {
    const rows = await render({
      state: stateOn(rowsOf([LOGGED_IN])),
      meters: () => METERED,
    })

    const meter = lineWith(rows, '▰')
    expect(meter).toContain('5h')
    expect(meter).toContain('wk')
    expect(meter).toContain('1h15m')
    expect(meter).toContain('30%')
  })

  it('says how a signed-out provider can be reached', async () => {
    const rows = await render({ state: stateOn(rowsOf([]), 2) })

    expect(rows.join('\n')).toContain('not signed in · api key')
  })

  it('points at the actions menu', async () => {
    const rows = await render({ state: stateOn(rowsOf([LOGGED_IN])) })

    expect(lineWith(rows, '⏎ actions')).not.toBe('')
  })
})

describe('the actions modal', () => {
  it('lists the actions the provider supports', async () => {
    const rows = await render({ state: openActions(stateOn(rowsOf([LOGGED_IN, IMPORTED]))) })
    const frame = rows.join('\n')

    expect(frame).toContain('Sign in')
    expect(frame).toContain('Add an API key')
    expect(frame).toContain('Switch active login')
    expect(frame).toContain('Remove a login')
  })

  it('marks the chosen action', async () => {
    const rows = await render({ state: openActions(stateOn(rowsOf([LOGGED_IN]))) })

    expect(lineWith(rows, 'Sign in')).toContain('▸')
  })

  it('offers no switching for a provider with a single login', async () => {
    const rows = await render({ state: openActions(stateOn(rowsOf([LOGGED_IN]))) })

    expect(rows.join('\n')).not.toContain('Switch active login')
  })
})

describe('the login picker modal', () => {
  it('titles itself for switching and lists every login', async () => {
    const state = openLoginPicker({
      state: openActions(stateOn(rowsOf([LOGGED_IN, IMPORTED]))),
      intent: EPickIntent.Use,
    })
    const rows = await render({ state })
    const frame = rows.join('\n')

    expect(frame).toContain('switch active login')
    expect(frame).toContain('dennis@trycomp.ai')
    expect(frame).toContain('Claude Code (team)')
  })

  it('titles itself for removal', async () => {
    const state = openLoginPicker({
      state: openActions(stateOn(rowsOf([LOGGED_IN, IMPORTED]))),
      intent: EPickIntent.Remove,
    })
    const rows = await render({ state })

    expect(rows.join('\n')).toContain('remove a login')
  })
})

describe('the sign-in prompt', () => {
  it('replaces the list with the paste-back flow', async () => {
    const state: AccountsState = {
      ...stateOn(rowsOf([])),
      view: EAccountsView.PastedCode,
      prompt: { provider: EAuthProvider.Anthropic, url: 'https://claude.com/auth' },
    }

    const rows = await render({ state })
    const frame = rows.join('\n')

    expect(frame).toContain('claude.com/auth')
    expect(frame).toContain('waiting for a paste')
    expect(frame).not.toContain('OTHER LOGINS')
  })

  it('shows the device code and takes no input', async () => {
    const state: AccountsState = {
      ...stateOn(rowsOf([])),
      view: EAccountsView.DeviceCode,
      prompt: {
        provider: EAuthProvider.OpenAI,
        url: 'https://auth.openai.com/codex/device',
        userCode: 'ABCD-EFGH',
      },
    }

    const rows = await render({ state })
    const frame = rows.join('\n')

    expect(frame).toContain('ABCD-EFGH')
    expect(frame).toContain('auth.openai.com/codex/device')
    expect(frame).toContain('waiting for approval')
    expect(frame).not.toContain('waiting for a paste')
  })
})

describe('the drawer chrome', () => {
  it('titles the drawer as the model provider list', async () => {
    const rows = await render({ state: stateOn(rowsOf([LOGGED_IN])) })

    expect(lineWith(rows, 'MODEL PROVIDERS')).not.toBe('')
  })

  it('hints only at arrows and enter in the list', async () => {
    const rows = await render({ state: stateOn(rowsOf([LOGGED_IN])) })

    const hints = lineWith(rows, 'esc close')
    expect(hints).toContain('↑↓ pick')
    expect(hints).toContain('⏎ actions')
    expect(hints).not.toContain('sign in')
    expect(hints).not.toContain('remove')
  })

  it('rules off the whole width, not a sidebar column', async () => {
    const rows = await render({ state: stateOn(rowsOf([LOGGED_IN])), width: 96 })

    const edge = rows.find((row) => row.trimStart().startsWith('─')) ?? ''

    expect(edge.trimEnd().length).toBe(96)
  })
})
