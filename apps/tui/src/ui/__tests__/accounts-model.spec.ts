import { describe, expect, it } from 'bun:test'

import {
  EAccountOrigin,
  EAccountStatus,
  EAuthKind,
  EAuthProvider,
  reachableProviders,
  toAccountId,
  type Account,
} from '@dltech/atlas-core'

import {
  acceptsDeviceCode,
  acceptsPastedCode,
  accountDetail,
  maskedKey,
  rowDetail,
  rowLabel,
} from '../accounts-labels'
import {
  accountOf,
  accountRows,
  EAccountRow,
  rowProvider,
  askForApiKey,
  askForCloudCode,
  askForCode,
  askForDeviceCode,
  askForGithubCode,
  announced,
  backspace,
  backToList,
  EAccountsView,
  failed,
  isPrompting,
  moveSelection,
  openAccounts,
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
  createdAt?: string
}): Account => ({
  id: toAccountId(args.id),
  provider: args.provider ?? EAuthProvider.Anthropic,
  kind: args.kind ?? EAuthKind.Oauth,
  origin: args.origin ?? EAccountOrigin.Login,
  label: args.id,
  status: args.status ?? EAccountStatus.Active,
  createdAt: args.createdAt ?? '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

const rowsOf = (accounts: readonly Account[], activeId?: string) =>
  accountRows({
    accounts,
    active: activeId === undefined ? {} : { [EAuthProvider.Anthropic]: toAccountId(activeId) },
    cloud: null,
  })

/**
 * List mechanics are about clamping an index, not about which providers ship reachable today, so
 * they run over the account rows alone — a flipped `reachable` flag must not move them.
 */
const signedInRows = (accounts: readonly Account[], activeId?: string) =>
  rowsOf(accounts, activeId).filter((row) => row.kind === EAccountRow.Account)

const reachable = (): readonly EAuthProvider[] => reachableProviders().map((spec) => spec.provider)

describe('accountRows', () => {
  it('marks the account that answers for its provider', () => {
    const rows = signedInRows([account({ id: 'work' }), account({ id: 'personal' })], 'personal')

    expect(rows.map((row) => [rowLabel(row), row.active])).toEqual([
      ['work', false],
      ['personal', true],
    ])
  })

  it('groups by provider, oldest first inside a provider', () => {
    const rows = accountRows({
      accounts: [
        account({ id: 'openrouter', provider: EAuthProvider.OpenRouter }),
        account({ id: 'second', createdAt: '2026-02-01T00:00:00.000Z' }),
        account({ id: 'first', createdAt: '2026-01-01T00:00:00.000Z' }),
      ],
      active: {},
      cloud: null,
    })

    expect(rows.filter((row) => row.kind === EAccountRow.Account).map(rowLabel)).toEqual([
      'first',
      'second',
      'openrouter',
    ])
  })
})

describe('a provider with no account yet', () => {
  const signedOut = (rows: readonly ReturnType<typeof accountRows>[number][]) =>
    rows.flatMap((row) => (row.kind === EAccountRow.SignedOut ? [row.provider] : []))

  it('offers a row for every reachable provider nothing is signed into', () => {
    const rows = accountRows({ accounts: [], active: {}, cloud: null })

    expect([...signedOut(rows)].sort()).toEqual([...reachable()].sort())
  })

  it('drops the placeholder once that provider has an account', () => {
    const rows = accountRows({ accounts: [account({ id: 'work' })], active: {}, cloud: null })

    expect(signedOut(rows)).not.toContain(EAuthProvider.Anthropic)
    expect(signedOut(rows).length).toBe(reachable().length - 1)
  })

  it('never offers a provider with no adapter behind it', () => {
    const rows = accountRows({ accounts: [], active: {}, cloud: null })

    for (const provider of signedOut(rows)) expect(reachable()).toContain(provider)
  })

  it('ranks placeholders with the accounts, not in a clump at the end', () => {
    const rows = accountRows({
      accounts: [account({ id: 'inference', provider: EAuthProvider.Inference })],
      active: {},
      cloud: null,
    }).filter((row) => row.kind !== EAccountRow.Cloud)

    expect(rows.map(rowProvider).at(-1)).toBe(EAuthProvider.Inference)
    expect(rows.at(-1)?.kind).toBe(EAccountRow.Account)
    expect(rows[0]?.kind).toBe(EAccountRow.SignedOut)
  })

  it('names the provider and says how to sign in, without crying wolf', () => {
    const row = accountRows({ accounts: [], active: {}, cloud: null }).find(
      (candidate) => rowProvider(candidate) === EAuthProvider.Anthropic,
    )
    if (row === undefined) throw new Error('expected a row')

    expect(rowLabel(row)).toBe('Anthropic')
    expect(rowDetail(row)).toContain('not signed in')
    expect(rowDetail(row)).not.toContain('⚠')
  })

  it('offers only the flows that provider actually accepts', () => {
    const rows = accountRows({ accounts: [], active: {}, cloud: null })
    const openrouter = rows.find((row) => rowProvider(row) === EAuthProvider.OpenRouter)
    const anthropic = rows.find((row) => rowProvider(row) === EAuthProvider.Anthropic)
    if (openrouter === undefined || anthropic === undefined) throw new Error('expected both')

    expect(rowDetail(openrouter)).toContain('api key')
    expect(rowDetail(openrouter)).not.toContain('sign in ')
    expect(rowDetail(anthropic)).toContain('sign in')
    expect(rowDetail(anthropic)).toContain('api key')
  })

  it('is never the active row, because nothing is answering for it', () => {
    const rows = accountRows({ accounts: [], active: {}, cloud: null })

    expect(rows.every((row) => !row.active)).toBe(true)
  })
})

describe('openAccounts', () => {
  it('starts on the account that answers today', () => {
    const state = openAccounts({ rows: rowsOf([account({ id: 'a' }), account({ id: 'b' })], 'b') })
    const picked = selectedRow(state)
    if (picked === undefined) throw new Error('expected a row')

    expect(rowLabel(picked)).toBe('b')
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
  const state = openAccounts({ rows: signedInRows([account({ id: 'a' }), account({ id: 'b' })]) })

  it('stops at each end rather than wrapping', () => {
    expect(moveSelection({ state, delta: -1 }).index).toBe(0)
    expect(moveSelection({ state, delta: 5 }).index).toBe(1)
  })

  it('has nothing to select in an empty vault', () => {
    const empty = openAccounts({ rows: [] })

    expect(moveSelection({ state: empty, delta: 1 })).toBe(empty)
    expect(selectedRow(empty)).toBeUndefined()
  })

  it('keeps the selection inside a list that shrank under it', () => {
    const removed = withRows({
      state: moveSelection({ state, delta: 1 }),
      rows: signedInRows([account({ id: 'a' })]),
    })

    const picked = selectedRow(removed)
    if (picked === undefined) throw new Error('expected a row')

    expect(removed.index).toBe(0)
    expect(rowLabel(picked)).toBe('a')
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

describe('the Atlas Cloud row', () => {
  const cloudRowOf = (rows: readonly ReturnType<typeof accountRows>[number][]) => {
    const row = rows[0]
    if (row === undefined || row.kind !== EAccountRow.Cloud) throw new Error('expected the cloud row')
    return row
  }

  it('leads the list whether or not a session exists', () => {
    const rows = accountRows({ accounts: [account({ id: 'work' })], active: {}, cloud: null })

    expect(rows[0]?.kind).toBe(EAccountRow.Cloud)
    expect(rows[1]?.kind).toBe(EAccountRow.Account)
  })

  it('offers sign-in when there is no session', () => {
    const row = cloudRowOf(accountRows({ accounts: [], active: {}, cloud: null }))

    expect(rowLabel(row)).toBe('Atlas Cloud')
    expect(rowDetail(row)).toBe('not signed in · sign in')
    expect(row.active).toBe(false)
  })

  it('names the signed-in account and how to leave', () => {
    const row = cloudRowOf(
      accountRows({ accounts: [], active: {}, cloud: { email: 'dennis@example.com' } }),
    )

    expect(rowLabel(row)).toBe('Atlas Cloud')
    expect(rowDetail(row)).toBe('dennis@example.com · press x to sign out')
  })

  it('still says signed in when the session carries no email', () => {
    const row = cloudRowOf(accountRows({ accounts: [], active: {}, cloud: { email: null } }))

    expect(rowDetail(row)).toBe('signed in · press x to sign out')
  })

  it('answers for no provider, so n and k leave it alone', () => {
    const row = cloudRowOf(accountRows({ accounts: [], active: {}, cloud: null }))

    expect(rowProvider(row)).toBeUndefined()
    expect(accountOf(row)).toBeUndefined()
  })

  it('drops back to sign-in once the session is gone', () => {
    const row = cloudRowOf(accountRows({ accounts: [], active: {}, cloud: null }))

    expect(row.session).toBeNull()
    expect(rowDetail(row)).toBe('not signed in · sign in')
  })
})

describe('the cloud sign-in prompt', () => {
  const TICKET_PROMPT = { url: 'http://localhost:3400/device', userCode: 'WXYZ-1234' }

  it('opens on the cloud device view without a provider behind the prompt', () => {
    const asked = askForCloudCode({ state: openAccounts({ rows: [] }) })

    expect(asked.view).toBe(EAccountsView.CloudDevice)
    expect(asked.cloudPrompt).toBeNull()
    expect(asked.prompt).toBeNull()
    expect(isPrompting(asked)).toBe(true)
    expect(asked.busy).toBe(false)
  })

  it('shows the code and the URL once the ticket arrives', () => {
    const asked = askForCloudCode({ state: openAccounts({ rows: [] }), prompt: TICKET_PROMPT })

    expect(asked.cloudPrompt?.userCode).toBe('WXYZ-1234')
    expect(asked.cloudPrompt?.url).toBe('http://localhost:3400/device')
  })

  it('fails in place when the ticket expires', () => {
    const asked = askForCloudCode({ state: openAccounts({ rows: [] }), prompt: TICKET_PROMPT })
    const expired = failed({ state: asked, reason: 'that code expired.' })

    expect(expired.failure).toBe('that code expired.')
    expect(expired.view).toBe(EAccountsView.CloudDevice)
    expect(expired.busy).toBe(false)
  })

  it('returns to the list with a notice when sign-in completes', () => {
    const asked = askForCloudCode({ state: openAccounts({ rows: [] }), prompt: TICKET_PROMPT })
    const done = announced({
      state: backToList(asked),
      notice: 'Signed in to Atlas Cloud as dennis@example.com.',
    })

    expect(done.view).toBe(EAccountsView.List)
    expect(done.cloudPrompt).toBeNull()
    expect(done.notice).toBe('Signed in to Atlas Cloud as dennis@example.com.')
  })

  it('leaves nothing behind when it is cancelled', () => {
    const asked = askForCloudCode({ state: openAccounts({ rows: [] }), prompt: TICKET_PROMPT })
    const cancelled = backToList(asked)

    expect(cancelled.view).toBe(EAccountsView.List)
    expect(cancelled.cloudPrompt).toBeNull()
    expect(cancelled.typed).toBe('')
  })
})

describe('the GitHub row', () => {
  const githubRowOf = (rows: readonly ReturnType<typeof accountRows>[number][]) =>
    rows.find((row) => row.kind === EAccountRow.Github)

  it('stays out of the list when there is no cloud session to hold the connection', () => {
    const rows = accountRows({ accounts: [], active: {}, cloud: null })

    expect(githubRowOf(rows)).toBeUndefined()
  })

  it('follows the cloud row once a session exists', () => {
    const rows = accountRows({
      accounts: [account({ id: 'work' })],
      active: {},
      cloud: { email: 'dennis@example.com' },
      github: { connection: null, unreachable: false },
    })

    expect(rows[0]?.kind).toBe(EAccountRow.Cloud)
    expect(rows[1]?.kind).toBe(EAccountRow.Github)
    expect(rows[2]?.kind).toBe(EAccountRow.Account)
  })

  it('invites the connection when there is none', () => {
    const row = githubRowOf(
      accountRows({
        accounts: [],
        active: {},
        cloud: { email: null },
        github: { connection: null, unreachable: false },
      }),
    )
    if (row === undefined) throw new Error('expected the github row')

    expect(rowLabel(row)).toBe('GitHub')
    expect(rowDetail(row)).toBe('not connected · enter to connect')
    expect(row.active).toBe(false)
  })

  it('names the login and how to disconnect once connected', () => {
    const row = githubRowOf(
      accountRows({
        accounts: [],
        active: {},
        cloud: { email: null },
        github: { connection: { login: 'octocat' }, unreachable: false },
      }),
    )
    if (row === undefined) throw new Error('expected the github row')

    expect(rowLabel(row)).toBe('GitHub')
    expect(rowDetail(row)).toBe('@octocat · press x to disconnect')
  })

  it('says so when Atlas Cloud could not be reached for the connection', () => {
    const row = githubRowOf(
      accountRows({
        accounts: [],
        active: {},
        cloud: { email: null },
        github: { connection: null, unreachable: true },
      }),
    )
    if (row === undefined) throw new Error('expected the github row')

    expect(rowDetail(row)).toBe("couldn't reach Atlas Cloud")
  })

  it('answers for no provider, so n and k leave it alone', () => {
    const row = githubRowOf(
      accountRows({
        accounts: [],
        active: {},
        cloud: { email: null },
        github: { connection: { login: 'octocat' }, unreachable: false },
      }),
    )
    if (row === undefined) throw new Error('expected the github row')

    expect(rowProvider(row)).toBeUndefined()
    expect(accountOf(row)).toBeUndefined()
  })
})

describe('the GitHub connect prompt', () => {
  const TICKET_PROMPT = { url: 'https://github.com/login/device', userCode: 'F00D-CAFE' }

  it('opens on the github device view without a code behind the prompt yet', () => {
    const asked = askForGithubCode({ state: openAccounts({ rows: [] }) })

    expect(asked.view).toBe(EAccountsView.GithubDevice)
    expect(asked.githubPrompt).toBeNull()
    expect(asked.cloudPrompt).toBeNull()
    expect(asked.prompt).toBeNull()
    expect(isPrompting(asked)).toBe(true)
    expect(asked.busy).toBe(false)
  })

  it('shows the code and the URL once the ticket arrives', () => {
    const asked = askForGithubCode({ state: openAccounts({ rows: [] }), prompt: TICKET_PROMPT })

    expect(asked.githubPrompt?.userCode).toBe('F00D-CAFE')
    expect(asked.githubPrompt?.url).toBe('https://github.com/login/device')
  })

  it('fails in place when the code expires', () => {
    const asked = askForGithubCode({ state: openAccounts({ rows: [] }), prompt: TICKET_PROMPT })
    const expired = failed({ state: asked, reason: 'that code expired.' })

    expect(expired.failure).toBe('that code expired.')
    expect(expired.view).toBe(EAccountsView.GithubDevice)
    expect(expired.busy).toBe(false)
  })

  it('returns to the list with a notice when the connection lands', () => {
    const asked = askForGithubCode({ state: openAccounts({ rows: [] }), prompt: TICKET_PROMPT })
    const done = announced({
      state: backToList(asked),
      notice: 'Connected GitHub as @octocat.',
    })

    expect(done.view).toBe(EAccountsView.List)
    expect(done.githubPrompt).toBeNull()
    expect(done.notice).toBe('Connected GitHub as @octocat.')
  })

  it('leaves nothing behind when it is cancelled', () => {
    const asked = askForGithubCode({ state: openAccounts({ rows: [] }), prompt: TICKET_PROMPT })
    const cancelled = backToList(asked)

    expect(cancelled.view).toBe(EAccountsView.List)
    expect(cancelled.githubPrompt).toBeNull()
    expect(cancelled.typed).toBe('')
  })
})

describe('accountDetail', () => {
  it('says where an account came from and what is wrong with it', () => {
    expect(
      accountDetail(
        account({
          id: 'a',
          kind: EAuthKind.ApiKey,
          origin: EAccountOrigin.Environment,
          status: EAccountStatus.Expired,
        }),
      ),
    ).toBe('Anthropic · api key · from the environment · expired')
  })

  it('says nothing about the status of an account that is fine', () => {
    expect(accountDetail(account({ id: 'a' }))).toBe('Anthropic · subscription')
  })

  it('says nothing about adapters for a provider that has one', () => {
    expect(
      accountDetail(
        account({ id: 'a', provider: EAuthProvider.OpenRouter, kind: EAuthKind.ApiKey }),
      ),
    ).toBe('OpenRouter · api key')
  })
})
