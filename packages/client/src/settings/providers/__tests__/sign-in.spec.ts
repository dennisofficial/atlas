import { describe, expect, it } from 'bun:test'
import {
  EOauthProvider,
  EProviderSignInFlow,
  EProviderSignInPoll,
  type AccountDto,
  type ProviderSignInBegin,
} from '@dltech/atlas-wire/web'
import { createProviderSignIn, EBrowserSignInResult, EProviderSignInState } from '../sign-in'

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
  it('finishes browser sign-in without beginning another flow', async () => {
    const { controller, opened, changes } = setup({
      browser: async ({ onWaiting }) => {
        onWaiting()
        return EBrowserSignInResult.SignedIn
      },
    })
    controller.start()
    expect(controller.getState().status).toBe(EProviderSignInState.Browser)
    await flush()
    expect(controller.getState().status).toBe(EProviderSignInState.Idle)
    expect(opened).toEqual([])
    expect(changes()).toBe(1)
  })
  it.each([
    paste,
    {
      flow: EProviderSignInFlow.DeviceCode,
      attemptId: 'device',
      userCode: 'AB-CD',
      verificationUrl: 'https://chatgpt.com/device',
      intervalMs: 100,
      expiresInMs: 60000,
    } satisfies ProviderSignInBegin,
  ])('falls back to the existing flow: %j', async (begun) => {
    const { controller, opened } = setup({
      browser: async () => EBrowserSignInResult.Fallback,
      begin: async () => begun,
    })
    controller.start()
    await flush()
    expect(opened).toEqual([
      begun.flow === EProviderSignInFlow.PasteCode ? begun.authorizeUrl : begun.verificationUrl,
    ])
  })
  it('aborts browser sign-in on cancel and ignores its late result', async () => {
    const deferred = Promise.withResolvers<EBrowserSignInResult>()
    let signal: AbortSignal | undefined
    const { controller, opened, changes } = setup({
      browser: (args) => {
        signal = args.signal
        return deferred.promise
      },
    })
    controller.start()
    controller.cancel()
    expect(signal?.aborted).toBe(true)
    deferred.resolve(EBrowserSignInResult.Fallback)
    await flush()
    expect(controller.getState().status).toBe(EProviderSignInState.Idle)
    expect(opened).toEqual([])
    expect(changes()).toBe(0)
  })
  it('aborts a replaced browser run and ignores its waiting callback and success', async () => {
    const stale = Promise.withResolvers<EBrowserSignInResult>()
    let previous:
      | Parameters<NonNullable<Parameters<typeof createProviderSignIn>[0]['browser']>>[0]
      | undefined
    const { controller, changes } = setup({
      browser: (args) => {
        if (!previous) {
          previous = args
          return stale.promise
        }
        return new Promise(() => undefined)
      },
    })
    controller.start()
    controller.start()
    expect(previous?.signal.aborted).toBe(true)
    previous?.onWaiting()
    stale.resolve(EBrowserSignInResult.SignedIn)
    await flush()
    expect(controller.getState().status).toBe(EProviderSignInState.Starting)
    expect(changes()).toBe(0)
    controller.cancel()
  })
  it.each([EBrowserSignInResult.Cancelled, EBrowserSignInResult.Failed])(
    'settles browser result %s without falling back',
    async (result) => {
      const { controller, opened, changes } = setup({ browser: async () => result })
      controller.start()
      await flush()
      expect(controller.getState().status).toBe(
        result === EBrowserSignInResult.Cancelled
          ? EProviderSignInState.Idle
          : EProviderSignInState.Failed,
      )
      expect(opened).toEqual([])
      expect(changes()).toBe(0)
    },
  )
  it('reports a browser rejection through the surface error mapper', async () => {
    const { controller } = setup({
      browser: async () => {
        throw new Error('Browser refused')
      },
      errorMessage: () => 'Mapped browser refusal',
    })
    controller.start()
    await flush()
    expect(controller.getState()).toEqual({
      status: EProviderSignInState.Failed,
      message: 'Mapped browser refusal',
    })
  })
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
