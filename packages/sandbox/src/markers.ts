export const SANDBOX_WORKLOADS_ENV = 'ATLAS_SANDBOX_WORKLOADS'

export const sandboxWorkloadsEnabled = (env: Record<string, string | undefined>): boolean =>
  env[SANDBOX_WORKLOADS_ENV] === '1'
