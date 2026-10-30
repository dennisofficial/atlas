export enum EGithubCallSource {
  PollSweep = 'poll-sweep',
  HookSweep = 'hook-sweep',
  DeliveryFill = 'delivery-fill',
  HookLifecycle = 'hook-lifecycle',
  RepoList = 'repo-list',
  RepoAccess = 'repo-access',
  RepoTree = 'repo-tree',
  SigningKey = 'signing-key',
  DeviceFlow = 'device-flow',
  SubscriptionResolve = 'subscription-resolve',
  Unattributed = 'unattributed',
}
