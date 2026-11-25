import { readResource, type PodResource } from '@dltech/atlas-plugin-sdk'
import type { CallOp } from '@dltech/atlas-protocol'
import { describe, expect, it } from 'bun:test'
import { z } from 'zod'

import { ReadyTimeoutError } from '../../calls/errors'
import { DIRECTORY, agentsRootOf, rig, skillsOf } from './plugin-resources-rig'

const FAILURE_MS = 50

const sleep = (ms: number): Promise<undefined> =>
  new Promise((resolve) => setTimeout(() => resolve(undefined), ms))

const failingCallOf = (args: { attempts: { count: number } }): ((op: CallOp) => Promise<void>) => {
  return async () => {
    args.attempts.count += 1
    await sleep(FAILURE_MS)
    throw new ReadyTimeoutError(60_000)
  }
}

const daemonResourceOf = (args: { name: string; loads: string[] }): PodResource<string> => ({
  name: args.name,
  schema: z.string(),
  watch: () => ({ roots: [agentsRootOf(DIRECTORY)] }),
  load: async ({ ctx }) => {
    args.loads.push(args.name)
    await ctx.call({ op: 'watch.status', watchIds: [] })
    return `${args.name} value`
  },
})

describe('a refresh against a sandbox that never answers', () => {
  it('stops issuing pod calls after the first ready failure', async () => {
    const attempts = { count: 0 }
    const loads: string[] = []
    const turn = rig({
      resources: [
        skillsOf(loads),
        daemonResourceOf({ name: 'instructions', loads }),
        daemonResourceOf({ name: 'notes', loads }),
      ],
      beforeCall: failingCallOf({ attempts }),
    })

    const startedAt = performance.now()
    await turn.run()
    const elapsed = performance.now() - startedAt

    expect(attempts.count).toBe(1)
    expect(loads).toEqual([])
    expect(elapsed).toBeLessThan(FAILURE_MS * 2)
  })

  it('leaves the resources unloaded and retries at the end of the turn', async () => {
    let failure: ReadyTimeoutError | undefined = new ReadyTimeoutError(60_000)
    const loads: string[] = []
    const instructions = daemonResourceOf({ name: 'instructions', loads })
    const turn = rig({
      resources: [instructions],
      beforeCall: async () => {
        if (failure !== undefined) throw failure
      },
    })

    await turn.run()
    expect(loads).toEqual([])
    expect(readResource({ ctx: turn.ctx, resource: instructions })).toBeUndefined()

    failure = undefined
    await turn.closed()

    expect(loads).toEqual(['instructions'])
    expect(readResource({ ctx: turn.ctx, resource: instructions })).toBe('instructions value')
  })

  it('still loads when the watch arm fails for a reason other than readiness', async () => {
    const loads: string[] = []
    const instructions = daemonResourceOf({ name: 'instructions', loads })
    const turn = rig({
      resources: [instructions],
      beforeCall: async (op) => {
        if (op.op !== 'watch.start') return
        throw new Error('the daemon refused the watch')
      },
    })

    await turn.run()

    expect(loads).toEqual(['instructions'])
    expect(readResource({ ctx: turn.ctx, resource: instructions })).toBe('instructions value')
  })
})
