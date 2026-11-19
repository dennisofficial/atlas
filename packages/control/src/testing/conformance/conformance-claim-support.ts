import type { ConformanceParams } from './conformance'
import { createSessionParams, HOLDER_HOST, makeHarness, mint, type Harness } from './support'

export type ClaimFixture = {
  reset(): Promise<void>
  harness(): Harness
  present(): Promise<number>
  releaseAll(): Promise<void>
  newSession(sessionId: string): Promise<void>
  preparedSession(sessionId: string): Promise<void>
}

export const claimFixtureOf = (params: ConformanceParams): ClaimFixture => {
  let harness: Harness | undefined
  const releases: (() => Promise<void>)[] = []

  const current = (): Harness => {
    if (harness === undefined) throw new Error('the claim fixture has not been reset')
    return harness
  }

  return {
    reset: async () => {
      await params.reset()
      harness = makeHarness(params.makeStore())
    },
    harness: current,
    present: async () => {
      const hostId = await params.nextHostId()
      releases.push(await params.holdPresence(hostId))
      return hostId
    },
    releaseAll: async () => {
      for (const release of releases.splice(0)) await release()
    },
    newSession: async (sessionId) => {
      await current().plane.createSession(
        createSessionParams({ sessionId, mainThreadId: `${sessionId}-thread` }),
      )
    },
    preparedSession: async (sessionId) => {
      const { plane } = current()
      const threadId = `${sessionId}-thread`
      await current().plane.createSession(
        createSessionParams({ sessionId, mainThreadId: threadId }),
      )
      const { epoch } = await plane.grant({ sessionId, hostId: HOLDER_HOST })
      const head = await plane.head({ threadId })
      const outcome = await plane.append({
        threadId,
        epoch,
        events: mint({ bodies: [{ type: 'workspace-prepared' }], epoch, from: head, threadId }),
      })
      if (!outcome.ok) throw new Error(JSON.stringify(outcome.refusal))
      await plane.revoke({ sessionId, wantsHolder: false })
    },
  }
}
