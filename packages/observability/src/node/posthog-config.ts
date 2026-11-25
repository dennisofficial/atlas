export const POSTHOG_KEY = 'phc_q27hvgM8kSbwyjca72m3v7QexFE25FfFG8n529zM2WqL'
export const POSTHOG_HOST = 'https://us.i.posthog.com'
export const AGENT_TRACE_SERVICE_NAME = 'atlas-agent'
export const SERVER_ERROR_DISTINCT_ID = 'atlas-server'
export const LONGEST_TRACED_TURN_MS = 24 * 60 * 60 * 1000

const nonEmpty = (value: string | undefined): string | undefined =>
  value === undefined || value.length === 0 ? undefined : value

export const deployCommitOf = (env: Record<string, string | undefined>): string | undefined =>
  nonEmpty(env.ATLAS_APP_VERSION) ??
  nonEmpty(env.RENDER_GIT_COMMIT) ??
  nonEmpty(env.VERCEL_GIT_COMMIT_SHA) ??
  nonEmpty(env.ATLAS_VERSION)
