import type { VercelCredentials } from '@dltech/atlas-harness'

const given = (value: string | undefined): string | undefined =>
  value === undefined || value.trim().length === 0 ? undefined : value.trim()

/**
 * The sandbox was created with the operator's Vercel credentials in its environment precisely so
 * serve can publish ports itself; a sandbox older than that wiring simply cannot expose.
 */
export const vercelCredentialsOf = (
  env: Record<string, string | undefined>,
): VercelCredentials | null => {
  const token = given(env.VERCEL_TOKEN)
  const teamId = given(env.VERCEL_TEAM_ID)
  const projectId = given(env.VERCEL_PROJECT_ID)
  if (token === undefined || teamId === undefined || projectId === undefined) return null
  return { token, teamId, projectId }
}
