export const SANDBOX_REGION = 'iad1'
export const SANDBOX_SERVE_PORT = 3000
export const SANDBOX_HOME_PATH = '/atlas/home'
export const WORKSPACE_PATH = '/atlas/workspaces/workspace'
export const SANDBOX_TIMEOUT_MS = 4 * 60 * 60 * 1000
export const SANDBOX_SNAPSHOT_RETENTION = { count: 1, deleteEvicted: true } as const
export const SANDBOX_LAUNCH_TIMEOUT_MS = 60_000
export const SANDBOX_QUICK_TIMEOUT_MS = 30_000

export type VercelCredentials = { token: string; teamId: string; projectId: string }

export type RetryPolicy = { attempts: number; delayMs: number }

export const settleRetry: RetryPolicy = { attempts: 30, delayMs: 5_000 }

export const imageOptimizeRetry: RetryPolicy = { attempts: 12, delayMs: 30_000 }

export const retrySleep = (policy: RetryPolicy): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, policy.delayMs))

export const githubCloneUrlOf = (repo: string): string => `https://github.com/${repo}.git`
