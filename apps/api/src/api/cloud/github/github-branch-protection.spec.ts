import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'

import { rememberBranchProtection } from './github-branch-protection'

const remember = (requiredContexts: readonly string[] | null) =>
  db.transaction((tx) =>
    rememberBranchProtection({
      tx,
      repoFullName: 'compai/app',
      protection: { baseBranch: 'main', requiredContexts },
    }),
  )

const stored = () => db.orm.public.GithubBranchProtection.all()

describe('rememberBranchProtection', () => {
  useTestDatabase()

  it('stores the contexts a read found for the base branch', async () => {
    await remember(['ci', 'lint'])

    expect(await stored()).toMatchObject([
      { repoFullName: 'compai/app', baseBranch: 'main', requiredContexts: ['ci', 'lint'] },
    ])
  })

  it('replaces the stored contexts and clears them when the branch requires nothing', async () => {
    await remember(['ci'])
    await remember([])

    expect(await stored()).toMatchObject([{ requiredContexts: [] }])
  })

  it('leaves the stored contexts alone when GitHub would not answer', async () => {
    await remember(['ci'])
    await remember(null)

    expect(await stored()).toMatchObject([{ requiredContexts: ['ci'] }])
  })
})
