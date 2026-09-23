import { describe, expect, it } from 'bun:test'

import {
  EAccountOrigin,
  EAccountStatus,
  EAuthKind,
  EAuthProvider,
  toAccountId,
  type Account,
} from '@dltech/atlas-core'

import { accountDetail, actionLabel, maskedKey, signedOutDetail } from '../accounts-labels'
import {
  acceptsDeviceCode,
  acceptsPastedCode,
  activeOf,
  askForApiKey,
  askForCode,
  askForDeviceCode,
  announced,
  backspace,
  backToActions,
  backToList,
  EAccountsView,
  EPickIntent,
  EProviderAction,
  failed,
  isPrompting,
  moveAction,
  movePick,
  moveSelection,
  openAccounts,
  openActions,
  openLoginPicker,
  othersOf,
  pickedAccount,
  providerActions,
  providerRows,
  selectedAction,
  selectedRow,
  typeInto,
  withRows,
} from '../accounts-model'

const account = (args: {
  id: string
  provider?: EAuthProvider
  kind?: EAuthKind
  origin?: EAccountOrigin
  status?: EAccountStatus
}): Account => ({
  id: toAccountId(args.id),
  provider: args.provider ?? EAuthProvider.Anthropic,
  kind: args.kind ?? EAuthKind.Oauth,
  origin: args.origin ?? EAccountOrigin.Login,
  label: args.id,
  status: args.status ?? EAccountStatus.Active,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

const rowsOf = (accounts: readonly Account[], activeId?: string) =>
  providerRows({
    accounts,
    active: activeId === undefined ? {} : { [EAuthProvider.Anthropic]: toAccountId(activeId) },
  })

describe('providerRows', () => {
  it('gives every provider a row, signed in or not', () => {
    const rows = providerRows({ accounts: [], active: {} })

    expect(rows.map((row) => row.provider)).toEqual([
      EAuthProvider.Anthropic,
      EAuthProvider.OpenAI,
      EAuthProvider.OpenRouter,
      EAuthProvider.Inference,
    ])
    expect(rows.every((row) => row.accounts.length === 0)).toBe(true)
  })

  it('files each account under its own provider', () => {
    const rows = providerRows({
      accounts: [
        account({ id: 'a' }),
        account({ id: 'b' }),
        account({ id: 'key', provider: EAuthProvider.OpenRouter, kind: EAuthKind.ApiKey }),
      ],
      active: {},
    })

    const anthropic = rows.find((row) => row.provider === EAuthProvider.Anthropic)
    const openrouter = rows.find((row) => row.provider === EAuthProvider.OpenRouter)

    expect(anthropic?.accounts.map((held) => held.label)).toEqual(['a', 'b'])
    expect(openrouter?.accounts.map((held) => held.label)).toEqual(['key'])
  })

  it('knows which account answers for the provider', () => {
    const row = rowsOf([account({ id: 'a' }), account({ id: 'b' })], 'b')[0]
    if (row === undefined) throw new Error('expected a row')

    expect(activeOf(row)?.label).toBe('b')
    expect(othersOf(row).map((held) => held.label)).toEqual(['a'])
  })
})

describe('providerActions', () => {
  it('offers sign-in flows for a provider with nothing yet', () => {
    const row = rowsOf([])[0]
    if (row === undefined) throw new Error('expected a row')

    expect(providerActions(row)).toEqual([EProviderAction.SignIn, EProviderAction.AddApiKey])
  })

  it('hides sign-in when the provider only takes an api key', () => {
    const rows = providerRows({ accounts: [], active: {} })
    const openrouter = rows.find((row) => row.provider === EAuthProvider.OpenRouter)
    if (openrouter === undefined) throw new Error('expected the row')

    expect(providerActions(openrouter)).toEqual([EProviderAction.AddApiKey])
  })

  it('offers switching only once there is something to switch to', () => {
    const single = rowsOf([account({ id: 'a' })], 'a')[0]
    const double = rowsOf([account({ id: 'a' }), account({ id: 'b' })], 'a')[0]
    if (single === undefined || double === undefined) throw new Error('expected rows')

    expect(providerActions(single)).not.toContain(EProviderAction.SwitchActive)
    expect(providerActions(double)).toContain(EProviderAction.SwitchActive)
    expect(providerActions(single)).toContain(EProviderAction.RemoveLogin)
  })
})

describe('openAccounts', () => {
  it('starts on the provider that answers today', () => {
    const rows = providerRows({
      accounts: [account({ id: 'a', provider: EAuthProvider.OpenAI })],
      active: { [EAuthProvider.OpenAI]: toAccountId('a') },
    })
    const state = openAccounts({ rows })

    expect(selectedRow(state)?.provider).toBe(EAuthProvider.OpenAI)
    expect(state.view).toBe(EAccountsView.List)
    expect(isPrompting(state)).toBe(false)
  })

  it('carries a notice in, which is how a failed boot explains itself', () => {
    const state = openAccounts({ rows: [], notice: 'The credential expired.' })

    expect(state.notice).toBe('The credential expired.')
    expect(state.index).toBe(0)
  })
})

describe('moving through the list', () => {
  const state = openAccounts({ rows: rowsOf([]) })

  it('stops at each end rather than wrapping', () => {
    expect(moveSelection({ state, delta: -1 }).index).toBe(0)
    expect(moveSelection({ state, delta: 99 }).index).toBe(state.rows.length - 1)
  })

  it('has nothing to select in an empty list', () => {
    const empty = openAccounts({ rows: [] })

    expect(moveSelection({ state: empty, delta: 1 })).toBe(empty)
    expect(selectedRow(empty)).toBeUndefined()
  })

  it('keeps the selection inside a list that shrank under it', () => {
    const removed = withRows({
      state: moveSelection({ state, delta: 3 }),
      rows: rowsOf([]).slice(0, 1),
    })

    expect(removed.index).toBe(0)
    expect(selectedRow(removed)?.provider).toBe(EAuthProvider.Anthropic)
  })
})

describe('the actions modal', () => {
  const state = openAccounts({ rows: rowsOf([account({ id: 'a' })], 'a') })

  it('opens on the first action and clamps movement', () => {
    const opened = openActions(state)

    expect(opened.view).toBe(EAccountsView.Actions)
    expect(opened.action).toBe(0)
    expect(moveAction({ state: opened, delta: -1 }).action).toBe(0)

    const last = providerActions(selectedRow(opened) ?? rowsOf([])[0]!).length - 1
    expect(moveAction({ state: opened, delta: 99 }).action).toBe(last)
  })

  it('reads the action under the cursor', () => {
    const opened = openActions(state)

    expect(selectedAction(opened)).toBe(providerActions(selectedRow(state) ?? rowsOf([])[0]!)[0])
  })

  it('refuses to open for a provider with no actions', () => {
    const empty = { ...state, rows: [], index: 0 }

    expect(openActions(empty).view).toBe(EAccountsView.List)
  })
})

describe('the login picker', () => {
  const state = openActions(
    openAccounts({ rows: rowsOf([account({ id: 'a' }), account({ id: 'b' })], 'a') }),
  )

  it('opens with an intent and clamps movement', () => {
    const picker = openLoginPicker({ state, intent: EPickIntent.Remove })

    expect(picker.view).toBe(EAccountsView.SwitchLogin)
    expect(picker.pickIntent).toBe(EPickIntent.Remove)
    expect(picker.pick).toBe(0)
    expect(movePick({ state: picker, delta: -1 }).pick).toBe(0)
    expect(movePick({ state: picker, delta: 99 }).pick).toBe(1)
  })

  it('reads the login under the cursor', () => {
    const picker = movePick({ state: openLoginPicker({ state, intent: EPickIntent.Use }), delta: 1 })

    expect(pickedAccount(picker)?.label).toBe('b')
  })

  it('goes back to the actions modal, not the list', () => {
    const picker = openLoginPicker({ state, intent: EPickIntent.Use })

    expect(backToActions(picker).view).toBe(EAccountsView.Actions)
  })
})

describe('the login prompt', () => {
  const state = openAccounts({ rows: [] })

  it('shows the URL to open and takes what is typed back', () => {
    const asked = askForCode({
      state,
      prompt: { provider: EAuthProvider.Anthropic, url: 'https://claude.com/auth' },
    })
    const typed = typeInto({ state: typeInto({ state: asked, text: 'cod' }), text: 'e' })

    expect(asked.view).toBe(EAccountsView.PastedCode)
    expect(asked.prompt?.url).toBe('https://claude.com/auth')
    expect(typed.typed).toBe('code')
    expect(backspace(typed).typed).toBe('cod')
  })

  it('clears a failure the moment the operator types again', () => {
    const asked = askForCode({
      state,
      prompt: { provider: EAuthProvider.Anthropic, url: 'https://claude.com/auth' },
    })
    const broken = failed({ state: asked, reason: 'the code was refused' })

    expect(broken.failure).toBe('the code was refused')
    expect(typeInto({ state: broken, text: 'a' }).failure).toBeNull()
  })

  it('leaves nothing typed behind when it closes', () => {
    const typed = typeInto({
      state: askForApiKey({ state, provider: EAuthProvider.OpenRouter }),
      text: 'sk-secret',
    })

    expect(backToList(typed).typed).toBe('')
    expect(backToList(typed).view).toBe(EAccountsView.List)
  })

  it('masks all but the last four characters of a key', () => {
    expect(maskedKey('sk-abcdefgh')).toBe('•••••••efgh')
    expect(maskedKey('abc')).toBe('•••')
  })
})

describe('the device-code prompt', () => {
  it('shows the code to type into the browser rather than taking input', () => {
    const asked = askForDeviceCode({
      state: openAccounts({ rows: [] }),
      prompt: {
        provider: EAuthProvider.OpenAI,
        url: 'https://auth.openai.com/codex/device',
        userCode: 'ABCD-EFGH',
      },
    })

    expect(asked.view).toBe(EAccountsView.DeviceCode)
    expect(asked.prompt?.userCode).toBe('ABCD-EFGH')
    expect(asked.prompt?.url).toBe('https://auth.openai.com/codex/device')
    expect(isPrompting(asked)).toBe(true)
    expect(asked.busy).toBe(false)
  })

  it('routes OpenAI to a device code and Anthropic to a paste-back', () => {
    expect(acceptsDeviceCode(EAuthProvider.OpenAI)).toBe(true)
    expect(acceptsPastedCode(EAuthProvider.OpenAI)).toBe(false)
    expect(acceptsPastedCode(EAuthProvider.Anthropic)).toBe(true)
    expect(acceptsDeviceCode(EAuthProvider.Anthropic)).toBe(false)
  })
})

describe('labels', () => {
  it('says what an account is and what is wrong with it, provider aside', () => {
    expect(
      accountDetail(
        account({
          id: 'a',
          kind: EAuthKind.ApiKey,
          origin: EAccountOrigin.Environment,
          status: EAccountStatus.Expired,
        }),
      ),
    ).toBe('api key · from the environment · expired')
  })

  it('says nothing extra about an account that is fine', () => {
    expect(accountDetail(account({ id: 'a' }))).toBe('subscription')
  })

  it('names each action the modal can offer', () => {
    expect(actionLabel(EProviderAction.SignIn)).toBe('Sign in')
    expect(actionLabel(EProviderAction.AddApiKey)).toBe('Add an API key')
    expect(actionLabel(EProviderAction.SwitchActive)).toBe('Switch active login')
    expect(actionLabel(EProviderAction.RemoveLogin)).toBe('Remove a login')
  })

  it('says how a signed-out provider can be reached, without crying wolf', () => {
    expect(signedOutDetail(EAuthProvider.Anthropic)).toContain('not signed in')
    expect(signedOutDetail(EAuthProvider.Anthropic)).toContain('sign in')
    expect(signedOutDetail(EAuthProvider.OpenRouter)).toContain('api key')
    expect(signedOutDetail(EAuthProvider.OpenRouter)).not.toContain('⚠')
  })
})

describe('notices', () => {
  it('announces without losing the failure-free state', () => {
    const done = announced({
      state: openAccounts({ rows: [] }),
      notice: 'Signed in as work.',
    })

    expect(done.notice).toBe('Signed in as work.')
    expect(done.failure).toBeNull()
  })
})
