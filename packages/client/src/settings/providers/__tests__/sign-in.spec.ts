import { describe, expect, it } from 'bun:test'
import {
  EOauthProvider,
  EProviderSignInFlow,
  EProviderSignInPoll,
  type AccountDto,
  type ProviderSignInBegin,
} from '@dltech/atlas-wire/web'
import { createProviderSignIn, EProviderSignInState } from '../sign-in'

const account: AccountDto = {
  id: 'one',
  provider: 'anthropic',
  kind: 'oauth',
  label: 'Plan',
  status: 'active',
  origin: 'login',
  updatedAt: '2026-11-01T00:00:00Z',
  createdAt: '2026-11-01T00:00:00Z',
}
const paste: ProviderSignInBegin = {
  flow: EProviderSignInFlow.PasteCode,
  attemptId: 'attempt',
  authorizeUrl: 'https://claude.ai/authorize',
  expiresInMs: 60000,
}
const flush = async () => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}
function setup(overrides: Partial<Parameters<typeof createProviderSignIn>[0]> = {}) {
  const opened: string[] = []
  const completed: { attemptId: string; code: string }[] = []
  let changes = 0
  const controller = createProviderSignIn({
    provider: EOauthProvider.Anthropic,
    begin: async () => paste,
    complete: async (input) => {
      completed.push(input)
      return account
    },
    poll: async () => ({ status: EProviderSignInPoll.Complete, account }),
    open: (url) => {
      opened.push(url)
    },
    onChanged: () => {
      changes += 1
    },
    now: () => 0,
    wait: async () => undefined,
    ...overrides,
  })
  return { controller, opened, completed, changes: () => changes }
}

describe('provider sign-in controller', () => {
  it('opens the paste flow, trims the code, completes and reloads once', async () => {
    const { controller, opened, completed, changes } = setup()
    const states: EProviderSignInState[] = []
    const unsubscribe = controller.subscribe(() => states.push(controller.getState().status))
    controller.start()
    expect(controller.getState().status).toBe(EProviderSignInState.Starting)
    await flush()
    expect(controller.getState().status).toBe(EProviderSignInState.AwaitingCode)
    expect(opened).toEqual(['https://claude.ai/authorize'])
    controller.submitCode('  code  ')
    controller.submitCode('duplicate')
    await flush()
    expect(completed).toEqual([{ attemptId: 'attempt', code: 'code' }])
    expect(changes()).toBe(1)
    expect(controller.getState().status).toBe(EProviderSignInState.Idle)
    expect(states).toContain(EProviderSignInState.Submitting)
    unsubscribe()
  })
  it('polls device approval without a callback', async () => {
    const { controller, opened, changes } = setup({
      begin: async () => ({
        flow: EProviderSignInFlow.DeviceCode,
        attemptId: 'device',
        userCode: 'AB-CD',
        verificationUrl: 'https://chatgpt.com/device',
        intervalMs: 100,
        expiresInMs: 60000,
      }),
    })
    controller.start()
    await flush()
    expect(opened).toEqual(['https://chatgpt.com/device'])
    expect(controller.getState().status).toBe(EProviderSignInState.Idle)
    expect(changes()).toBe(1)
  })
  it('ignores a begin response after cancel', async () => {
    const deferred = Promise.withResolvers<ProviderSignInBegin>()
    const { controller, opened, changes } = setup({ begin: () => deferred.promise })
    controller.start()
    controller.cancel()
    deferred.resolve(paste)
    await flush()
    expect(opened).toEqual([])
    expect(changes()).toBe(0)
    expect(controller.getState().status).toBe(EProviderSignInState.Idle)
  })
  it('ignores completion after cancel and guards blank codes', async () => {
    const deferred = Promise.withResolvers<AccountDto>()
    const { controller, changes } = setup({ complete: () => deferred.promise })
    controller.start()
    await flush()
    controller.submitCode(' ')
    expect(controller.getState().status).toBe(EProviderSignInState.AwaitingCode)
    controller.submitCode('code')
    controller.cancel()
    deferred.resolve(account)
    await flush()
    expect(changes()).toBe(0)
    expect(controller.getState().status).toBe(EProviderSignInState.Idle)
  })
  it('reports begin and completion failures and permits a fresh attempt', async () => {
    const { controller } = setup({
      complete: async () => {
        throw new Error('Code rejected')
      },
    })
    controller.start()
    await flush()
    controller.submitCode('code')
    await flush()
    expect(controller.getState()).toEqual({
      status: EProviderSignInState.Failed,
      message: 'Code rejected',
    })
    controller.start()
    await flush()
    expect(controller.getState().status).toBe(EProviderSignInState.AwaitingCode)
    const failed = setup({
      begin: async () => {
        throw new Error('Offline')
      },
    })
    failed.controller.start()
    await flush()
    expect(failed.controller.getState()).toEqual({
      status: EProviderSignInState.Failed,
      message: 'Offline',
    })
  })
  it('uses the surface error mapping and a non-empty fallback', async () => {
    const mapped = setup({
      begin: async () => {
        throw new Error('refused')
      },
      errorMessage: () => 'Mapped refusal',
    })
    mapped.controller.start()
    await flush()
    expect(mapped.controller.getState()).toEqual({
      status: EProviderSignInState.Failed,
      message: 'Mapped refusal',
    })
    const fallback = setup({
      begin: async () => {
        throw new Error('')
      },
    })
    fallback.controller.start()
    await flush()
    expect(fallback.controller.getState()).toEqual({
      status: EProviderSignInState.Failed,
      message: 'Could not save the change',
    })
  })
  it('reports an expired device code', async () => {
    const { controller } = setup({
      begin: async () => ({
        flow: EProviderSignInFlow.DeviceCode,
        attemptId: 'device',
        userCode: 'AB-CD',
        verificationUrl: 'https://chatgpt.com/device',
        intervalMs: 100,
        expiresInMs: 60000,
      }),
      poll: async () => ({ status: EProviderSignInPoll.Expired }),
    })
    controller.start()
    await flush()
    expect(controller.getState()).toEqual({
      status: EProviderSignInState.Failed,
      message: 'That code expired',
    })
  })
})
