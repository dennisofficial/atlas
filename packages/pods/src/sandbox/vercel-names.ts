export const POD_SANDBOX_PREFIX = 'atlas-v2-'

export const sandboxNameOf = (sandboxSessionId: string): string =>
  `${POD_SANDBOX_PREFIX}${sandboxSessionId}`

/** Whether a sandbox name in the project is one this host created for a pod. */
export const isPodSandboxName = (name: string): boolean => name.startsWith(POD_SANDBOX_PREFIX)

export const podSessionIdOfSandboxName = (name: string): string | null =>
  isPodSandboxName(name) ? name.slice(POD_SANDBOX_PREFIX.length) : null
