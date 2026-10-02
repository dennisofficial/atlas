import { writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'bun:test'

import { buildSession, deferred, manifestFor, removeFixtureHomes, settle } from './workspace-session-fixture'

afterEach(removeFixtureHomes)

describe('concurrent workspace export requests', () => {
  it('takes one snapshot and returns the same export to requests arriving together', async () => {
    const gate = deferred()
    let captures = 0
    const { session, exported } = await buildSession({
      capture: async ({ cwd, destination }) => {
        captures += 1
        await gate.promise
        await writeFile(destination, 'snapshot')
        return manifestFor(cwd)
      },
    })

    const first = session.prepare()
    const second = session.prepare()
    await settle()
    gate.release()
    const replies = await Promise.all([first, second])

    expect(captures).toBe(1)
    expect(replies[0]?.path).toBe(replies[1]?.path)
    expect(await exported()).toHaveLength(1)
  })
})
