import { ATLAS_TESTING_ENV } from './atlas-home'

export const ATLAS_TELEMETRY_ENV = 'ATLAS_TELEMETRY'
export const ATLAS_TELEMETRY_IDENTITY_ENV = 'ATLAS_TELEMETRY_IDENTITY'

const underTestRunner = (env: Record<string, string | undefined>): boolean =>
  env[ATLAS_TESTING_ENV] === '1' || env.NODE_ENV === 'test'

/**
 * Telemetry is on for every real session and off under the repo's test runner — the same
 * ATLAS_TESTING / NODE_ENV=test signal `atlasHomeFrom` keys on, so a spec never reaches PostHog.
 * ATLAS_TELEMETRY wins both ways: `0` opts a real session out, `1` re-enables under a test runner
 * for the specs that exercise the capture path itself.
 */
export function telemetryEnabled(env: Record<string, string | undefined>): boolean {
  const explicit = env[ATLAS_TELEMETRY_ENV]
  if (explicit === '0') return false
  if (explicit === '1') return true
  return !underTestRunner(env)
}
