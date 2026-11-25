import { isAgent37Missing, type Agent37Client } from './agent37-client'
import { waitForAgent37Instance } from './agent37-daemon'
import { pollPause } from './agent37-poll'
import type { Agent37Health, Agent37Instance } from './agent37-types'

const POLL_MS = 2_000
const TRANSIENT_STATUSES: ReadonlySet<string> = new Set([
  'provisioning',
  'starting',
  'updating',
  'waking',
  'restarting',
  'stopping',
])
const ASLEEP_STATUSES: ReadonlySet<string> = new Set(['sleeping', 'stopped'])

export const AGENT37_WEDGED_RESTARTS = 3
export const AGENT37_SETTLE_BUDGET_MS = 10 * 60_000

const secondsOf = (ms: number): number => Math.floor(ms / 1000)

export const agent37WedgedOf = (health: Agent37Health | null): boolean =>
  health !== null && !health.running && health.restart_count >= AGENT37_WEDGED_RESTARTS

// https://www.agent37.com/docs/agents-api/instances/resize — a host move leaves the instance in
// `updating` after the request answers 202, and every call on it answers 409 `try_again` until it
// settles, so a sleep or exec that starts during the move spends its retries for nothing.
export const settleAgent37Instance = async (args: {
  client: Agent37Client
  id: string
  budgetMs?: number | undefined
  pollMs?: number | undefined
  signal?: AbortSignal | undefined
  log?: ((line: string) => void) | undefined
}): Promise<Agent37Instance> => {
  const budgetMs = args.budgetMs ?? AGENT37_SETTLE_BUDGET_MS
  const pollMs = args.pollMs ?? POLL_MS
  const deadline = Date.now() + budgetMs
  for (;;) {
    args.signal?.throwIfAborted()
    const instance = await args.client.get({ id: args.id })
    if (!TRANSIENT_STATUSES.has(instance.status)) return instance
    if (Date.now() >= deadline) {
      throw new Error(
        `agent37 instance ${args.id} stayed ${instance.status} for ${secondsOf(
          budgetMs,
        )}s instead of settling`,
      )
    }
    args.log?.(`agent37 instance ${args.id} is ${instance.status}; waiting for it to settle`)
    await pollPause({ ms: pollMs, signal: args.signal })
  }
}

// https://www.agent37.com/docs/agents-api/instances/update.md — an update resets the operating
// system layer and keeps the disk at mount_path, which is the clean-slate repair for a container
// that crash-loops because that layer is full. The instance status stays `running` throughout, so
// the logs' health is the only signal that it is wedged.
export const repairAgent37IfWedged = async (args: {
  client: Agent37Client
  id: string
  budgetMs?: number | undefined
  pollMs?: number | undefined
  signal?: AbortSignal | undefined
  log?: ((line: string) => void) | undefined
}): Promise<boolean> => {
  const budgetMs = args.budgetMs ?? AGENT37_SETTLE_BUDGET_MS
  const pollMs = args.pollMs ?? POLL_MS
  const health = (await args.client.logs({ id: args.id })).health
  if (!agent37WedgedOf(health)) return false
  const restarts = health === null ? 0 : health.restart_count
  args.log?.(
    `agent37 instance ${args.id} crash-loops (restart_count ${restarts}); resetting its os layer`,
  )
  args.signal?.throwIfAborted()
  await args.client.update({ id: args.id })
  await waitForAgent37Instance({
    client: args.client,
    instanceId: args.id,
    budgetMs,
    signal: args.signal,
    ...(args.log === undefined ? {} : { log: args.log }),
  })
  const deadline = Date.now() + budgetMs
  for (;;) {
    args.signal?.throwIfAborted()
    if ((await args.client.logs({ id: args.id })).health?.running === true) return true
    if (Date.now() >= deadline) {
      throw new Error(
        `agent37 instance ${args.id} did not run after its os layer was reset within ${secondsOf(
          budgetMs,
        )}s`,
      )
    }
    await pollPause({ ms: pollMs, signal: args.signal })
  }
}

/**
 * https://www.agent37.com/docs/agents-api/instances/start — a checkpointed instance answers nothing
 * on its ports until it is started, so a wake that only waited for the daemon spent its budget on a
 * pod that was never coming back.
 */
export const readyAgent37Instance = async (args: {
  client: Agent37Client
  id: string
  pollMs?: number | undefined
  signal?: AbortSignal | undefined
  log?: ((line: string) => void) | undefined
}): Promise<void> => {
  const instance = await settleAgent37Instance(args)
  if (ASLEEP_STATUSES.has(instance.status)) {
    args.signal?.throwIfAborted()
    await args.client.start({ id: args.id })
    await waitForAgent37Instance({
      client: args.client,
      instanceId: args.id,
      signal: args.signal,
      ...(args.log === undefined ? {} : { log: args.log }),
    })
    return
  }
  if (instance.status === 'running') await repairAgent37IfWedged(args)
}

export const sleepAgent37Instance = async (args: {
  client: Agent37Client
  id: string
  pollMs?: number | undefined
  signal?: AbortSignal | undefined
  log?: ((line: string) => void) | undefined
}): Promise<void> => {
  let instance: Agent37Instance
  try {
    instance = await settleAgent37Instance(args)
  } catch (failure) {
    if (isAgent37Missing(failure)) return
    throw failure
  }
  if (ASLEEP_STATUSES.has(instance.status)) return
  if (instance.status !== 'running') return
  await repairAgent37IfWedged(args)
  await args.client.sleep({ id: args.id })
}
