import {
  type AccountDto,
  EProviderSignInFlow,
  EProviderSignInPoll,
  type EOauthProvider,
  type ProviderSignInBegin,
  type ProviderSignInPoll,
} from '@dltech/atlas-wire/web'

export enum EProviderSignInState {
  Idle = 'idle',
  Starting = 'starting',
  AwaitingCode = 'awaiting-code',
  Submitting = 'submitting',
  Waiting = 'waiting',
  Failed = 'failed',
}
export type ProviderSignInFlow =
  | { status: EProviderSignInState.Idle }
  | { status: EProviderSignInState.Starting }
  | { status: EProviderSignInState.AwaitingCode; authorizeUrl: string }
  | { status: EProviderSignInState.Submitting; authorizeUrl: string }
  | { status: EProviderSignInState.Waiting; userCode: string; verificationUrl: string }
  | { status: EProviderSignInState.Failed; message: string }
export type ProviderSignInControl = {
  flow: ProviderSignInFlow
  start: () => void
  cancel: () => void
  submitCode: (code: string) => void
}

export async function pollSignInUntilSettled(args: {
  attemptId: string
  intervalMs: number
  expiresInMs: number
  poll: (attemptId: string) => Promise<ProviderSignInPoll>
  wait: (ms: number) => Promise<void>
  now: () => number
  isCancelled: () => boolean
}): Promise<ProviderSignInPoll | null> {
  const deadline = args.now() + args.expiresInMs
  for (;;) {
    await args.wait(args.intervalMs)
    if (args.isCancelled()) return null
    if (args.now() > deadline) return { status: EProviderSignInPoll.Expired }
    const result = await args.poll(args.attemptId)
    if (args.isCancelled()) return null
    if (result.status !== EProviderSignInPoll.Pending) return result
  }
}

export function createProviderSignIn(args: {
  provider: EOauthProvider
  begin: (provider: EOauthProvider) => Promise<ProviderSignInBegin>
  complete: (args: { attemptId: string; code: string }) => Promise<AccountDto>
  poll: (attemptId: string) => Promise<ProviderSignInPoll>
  open: (url: string) => void
  errorMessage?: (error: unknown) => string
  onChanged: () => void
  wait: (ms: number) => Promise<void>
  now: () => number
}) {
  let flow: ProviderSignInFlow = { status: EProviderSignInState.Idle }
  let run = 0
  let attempt: { attemptId: string; authorizeUrl: string } | null = null
  const listeners = new Set<() => void>()
  const publish = (next: ProviderSignInFlow) => {
    flow = next
    for (const listener of listeners) listener()
  }
  const fail = (error: unknown) =>
    publish({
      status: EProviderSignInState.Failed,
      message:
        args.errorMessage?.(error) ??
        (error instanceof Error && error.message.length > 0
          ? error.message
          : 'Could not save the change'),
    })
  const cancel = () => {
    run += 1
    attempt = null
    publish({ status: EProviderSignInState.Idle })
  }
  const start = () => {
    const id = ++run
    const isCurrent = () => id === run
    attempt = null
    publish({ status: EProviderSignInState.Starting })
    void (async () => {
      try {
        const begun = await args.begin(args.provider)
        if (!isCurrent()) return
        if (begun.flow === EProviderSignInFlow.PasteCode) {
          attempt = { attemptId: begun.attemptId, authorizeUrl: begun.authorizeUrl }
          publish({ status: EProviderSignInState.AwaitingCode, authorizeUrl: begun.authorizeUrl })
          args.open(begun.authorizeUrl)
          return
        }
        if (begun.flow !== EProviderSignInFlow.DeviceCode)
          throw new Error('the api began a sign-in this page cannot finish')
        publish({
          status: EProviderSignInState.Waiting,
          userCode: begun.userCode,
          verificationUrl: begun.verificationUrl,
        })
        args.open(begun.verificationUrl)
        const result = await pollSignInUntilSettled({
          attemptId: begun.attemptId,
          intervalMs: begun.intervalMs,
          expiresInMs: begun.expiresInMs,
          poll: args.poll,
          wait: args.wait,
          now: args.now,
          isCancelled: () => !isCurrent(),
        })
        if (result === null) return
        if (result.status !== EProviderSignInPoll.Complete) throw new Error('That code expired')
        publish({ status: EProviderSignInState.Idle })
        args.onChanged()
      } catch (error) {
        if (isCurrent()) fail(error)
      }
    })()
  }
  const submitCode = (code: string) => {
    if (attempt === null || flow.status !== EProviderSignInState.AwaitingCode || code.trim() === '')
      return
    const current = attempt
    const id = run
    publish({ status: EProviderSignInState.Submitting, authorizeUrl: current.authorizeUrl })
    void args
      .complete({ attemptId: current.attemptId, code: code.trim() })
      .then(() => {
        if (id !== run) return
        attempt = null
        publish({ status: EProviderSignInState.Idle })
        args.onChanged()
      })
      .catch((error: unknown) => {
        if (id === run) fail(error)
      })
  }
  return {
    getState: () => flow,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    start,
    cancel,
    submitCode,
  }
}
