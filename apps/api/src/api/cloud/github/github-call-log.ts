import { AsyncLocalStorage } from 'node:async_hooks'

export enum EGithubCallSource {
  PollSweep = 'poll-sweep',
  HookSweep = 'hook-sweep',
  DeliveryFill = 'delivery-fill',
  HookLifecycle = 'hook-lifecycle',
  RepoList = 'repo-list',
  RepoAccess = 'repo-access',
  SigningKey = 'signing-key',
  DeviceFlow = 'device-flow',
  SubscriptionResolve = 'subscription-resolve',
  Unattributed = 'unattributed',
}

const storage = new AsyncLocalStorage<EGithubCallSource>()

export function withGithubCallSource<T>(args: {
  source: EGithubCallSource
  run: () => Promise<T>
}): Promise<T> {
  return storage.run(args.source, args.run)
}

export function currentGithubCallSource(): EGithubCallSource {
  return storage.getStore() ?? EGithubCallSource.Unattributed
}
