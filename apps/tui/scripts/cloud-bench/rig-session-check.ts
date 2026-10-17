import { liveSdk, SERVE_HOME, SERVE_LOG_PATH } from '@dltech/atlas-wire'

import type { ScenarioContext } from './rig-context'

const GET_TIMEOUT_MS = 30_000
const STOP_REFUSAL = 'park-stop-failed|refusing to stop'
const SESSION_ENV = 'ATLAS_SANDBOX_SESSION_ID'

export type SessionCheck = { held: boolean; observed: string }

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const shortId = (id: string): string => (id.length > 12 ? `${id.slice(0, 12)}…` : id)

export async function serveSessionMatchesLive(ctx: ScenarioContext): Promise<SessionCheck> {
  const name = ctx.sandboxName()
  try {
    const sandbox = await liveSdk.get({
      ...ctx.env.credentials,
      name,
      resume: false,
      signal: AbortSignal.timeout(GET_TIMEOUT_MS),
    })
    if (sandbox.status !== 'running') return { held: false, observed: `box not running (${sandbox.status})` }
    const live = sandbox.currentSession().sessionId
    const script = `p=$(cat ${SERVE_HOME}/atlas-serve.pid); tr '\\0' '\\n' < /proc/$p/environ | sed -n 's/^${SESSION_ENV}=//p'`
    const held = (await ctx.probes.sh({ name, script })).trim()
    if (held.length === 0) return { held: false, observed: `serve has no ${SESSION_ENV}; live ${shortId(live)}` }
    return { held: held === live, observed: `serve ${shortId(held)}, live ${shortId(live)}` }
  } catch (error) {
    return { held: false, observed: `probe failed: ${messageOf(error)}` }
  }
}

export async function stopRefusalsInServeLog(ctx: ScenarioContext): Promise<SessionCheck> {
  const script = `grep -cE '${STOP_REFUSAL}' ${SERVE_LOG_PATH} || true`
  try {
    const count = Number((await ctx.probes.sh({ name: ctx.sandboxName(), script })).trim())
    return { held: count === 0, observed: `${Number.isNaN(count) ? 'unreadable' : count} stop-refusal line(s) in the whole serve log` }
  } catch (error) {
    return { held: false, observed: `probe failed: ${messageOf(error)}` }
  }
}
