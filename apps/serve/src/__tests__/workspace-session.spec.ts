import { afterEach, describe, expect, it } from 'bun:test'

import { buildSession, deferred, removeFixtureHomes, settle } from './workspace-session-fixture'

afterEach(removeFixtureHomes)

describe('applying a workspace generation through the session', () => {
  it('goes dormant when a new generation is restored, and answers nothing without an archive', async () => {
    const { session, supply } = await buildSession()

    expect(await session.apply()).toBeNull()
    expect(session.dormant()).toBe(false)

    await supply('generation-one')
    const applied = await session.apply()

    expect(applied?.applied).toBe(true)
    expect(session.dormant()).toBe(true)
  })

  it('leaves the session as it was when the same generation arrives again', async () => {
    const { session, supply, restores } = await buildSession()
    await supply('generation-one')
    await session.apply()
    await session.activate()

    await supply('generation-one')
    const again = await session.apply()

    expect(again?.applied).toBe(false)
    expect(restores()).toBe(1)
    expect(session.dormant()).toBe(false)
  })

  it('goes dormant again for a later generation and adopts the children again', async () => {
    const { session, supply, events } = await buildSession()
    await supply('one')
    await session.apply()
    await session.activate()
    await supply('two')
    await session.apply()

    expect(session.dormant()).toBe(true)
    await session.activate()

    expect(events.filter((entry) => entry === 'start')).toHaveLength(2)
    expect(session.dormant()).toBe(false)
  })

  it('stays awake and rejects when the restore itself fails', async () => {
    const { session, supply, direct } = await buildSession({
      restore: async () => {
        throw new Error('the archive did not verify')
      },
    })
    await supply('broken')

    await expect(session.apply()).rejects.toThrow('did not verify')

    expect(session.dormant()).toBe(false)
    expect(await direct.receipt()).toBeNull()
  })
})

describe('activating a dormant session', () => {
  it('adopts the children while the receipt is unactivated, then records it, then wakes', async () => {
    const seenDuringAdoption: (boolean | undefined)[] = []
    const { session, supply, direct } = await buildSession({
      startChildren: async (workspace) => {
        seenDuringAdoption.push((await workspace.receipt())?.activated)
      },
    })
    await supply('generation')
    await session.apply()

    const result = await session.activate()

    expect(result).toEqual({ activated: true })
    expect(seenDuringAdoption).toEqual([false])
    expect((await direct.receipt())?.activated).toBe(true)
    expect(session.dormant()).toBe(false)
  })

  it('does nothing for a session that was never dormant', async () => {
    const { session, events, direct } = await buildSession()

    expect(await session.activate()).toEqual({ activated: true })

    expect(events).toEqual([])
    expect(await direct.receipt()).toBeNull()
  })

  it('stays dormant with an unactivated receipt when adoption fails, and a retry succeeds', async () => {
    let attempts = 0
    const { session, supply, direct } = await buildSession({
      startChildren: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('a child could not be adopted')
      },
    })
    await supply('generation')
    await session.apply()

    await expect(session.activate()).rejects.toThrow('could not be adopted')

    expect(session.dormant()).toBe(true)
    expect((await direct.receipt())?.activated).toBe(false)

    expect(await session.activate()).toEqual({ activated: true })
    expect(session.dormant()).toBe(false)
    expect((await direct.receipt())?.activated).toBe(true)
    expect(attempts).toBe(2)
  })

  it('adopts the children once when two activations arrive together', async () => {
    const gate = deferred()
    let adoptions = 0
    const { session, supply, direct } = await buildSession({
      startChildren: async () => {
        adoptions += 1
        await gate.promise
      },
    })
    await supply('generation')
    await session.apply()

    const first = session.activate()
    const second = session.activate()
    await settle()
    gate.release()
    const answers = await Promise.all([first, second])

    expect(answers).toEqual([{ activated: true }, { activated: true }])
    expect(adoptions).toBe(1)
    expect((await direct.receipt())?.activated).toBe(true)
  })

  it('does not answer a second activation before the first has finished adopting', async () => {
    const gate = deferred()
    const { session, supply } = await buildSession({ startChildren: () => gate.promise })
    await supply('generation')
    await session.apply()

    const first = session.activate()
    let answered = false
    const second = session.activate().then((answer) => {
      answered = true
      return answer
    })
    await settle()

    expect(answered).toBe(false)
    gate.release()
    await Promise.all([first, second])
  })
})
