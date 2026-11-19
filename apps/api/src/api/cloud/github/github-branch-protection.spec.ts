import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'

import { rememberBranchProtection } from './github-branch-protection'

const ACQUIRED_AT = new Date('2026-11-18T10:00:00.000Z')

const remember = (args: { acquiredAt?: Date; requiredContexts: readonly string[] | null }) =>
  db.transaction((tx) =>
    rememberBranchProtection({
      tx,
      repoFullName: 'compai/app',
      protection: {
        acquiredAt: args.acquiredAt ?? ACQUIRED_AT,
        baseBranch: 'main',
        requiredContexts: args.requiredContexts,
      },
    }),
  )

const stored = () => db.orm.public.GithubBranchProtection.all()

describe('rememberBranchProtection', () => {
  useTestDatabase()

  it('stores the contexts a read found for the base branch at the read time', async () => {
    await remember({ requiredContexts: ['ci', 'lint'] })

    expect(await stored()).toMatchObject([
      {
        repoFullName: 'compai/app',
        baseBranch: 'main',
        requiredContexts: ['ci', 'lint'],
        fetchedAt: ACQUIRED_AT,
      },
    ])
  })

  it('replaces the stored contexts and clears them when the branch requires nothing', async () => {
    await remember({ requiredContexts: ['ci'] })
    await remember({ acquiredAt: new Date('2026-11-18T10:00:10.000Z'), requiredContexts: [] })

    expect(await stored()).toMatchObject([{ requiredContexts: [] }])
  })

  it('leaves the stored contexts alone when GitHub would not answer', async () => {
    await remember({ requiredContexts: ['ci'] })
    await remember({ acquiredAt: new Date('2026-11-18T10:00:10.000Z'), requiredContexts: null })

    expect(await stored()).toMatchObject([{ requiredContexts: ['ci'] }])
  })

  it('keeps the newer acquisition when an older read is applied after it', async () => {
    const newer = new Date('2026-11-18T10:00:05.000Z')
    const older = new Date('2026-11-18T10:00:01.000Z')
    await remember({ acquiredAt: newer, requiredContexts: ['fresh'] })
    await remember({ acquiredAt: older, requiredContexts: ['stale'] })

    expect(await stored()).toMatchObject([{ requiredContexts: ['fresh'], fetchedAt: newer }])
  })

  it('takes the newer acquisition whichever order the two reads are applied in', async () => {
    const older = new Date('2026-11-18T10:00:01.000Z')
    const newer = new Date('2026-11-18T10:00:05.000Z')
    await remember({ acquiredAt: older, requiredContexts: ['stale'] })
    await remember({ acquiredAt: newer, requiredContexts: ['fresh'] })

    expect(await stored()).toMatchObject([{ requiredContexts: ['fresh'], fetchedAt: newer }])
  })
})
