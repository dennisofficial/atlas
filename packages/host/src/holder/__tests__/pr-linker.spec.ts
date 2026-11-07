import { describe, expect, it } from 'bun:test'

import { toRunId, toThreadId, type BranchObservation, type EventDraft } from '@dltech/atlas-core'

import type { FoundPullRequest, PullRequestSource } from '../ports'
import { PrLinker } from '../pr-linker'

type Linked = Extract<EventDraft, { type: 'pull-request-linked' }>

const observation = (change: Partial<BranchObservation> = {}): BranchObservation => ({
  repo: '/w',
  head: 'main',
  base: 'main',
  branches: [
    { name: 'main', sha: 'a1' },
    { name: 'feat-x', sha: 'b1' },
  ],
  worktrees: [{ path: '/wt/feat-x', branch: 'feat-x', sha: 'b1', detached: false }],
  ...change,
})

const rig = (args: {
  observation?: BranchObservation | undefined
  find?: (branch: string) => Promise<FoundPullRequest | null>
  repoOf?: (path: string) => string | null
}) => {
  let current = args.observation ?? observation()
  const appended: Linked[] = []
  const asked: string[] = []
  const source: PullRequestSource = {
    repoOf: args.repoOf ?? (() => 'Acme/Web'),
    finder: {
      find: async ({ branch }) => {
        asked.push(branch)
        return (await args.find?.(branch)) ?? null
      },
    },
  }
  const linker = new PrLinker({
    source,
    record: {
      append: async ({ body }) => {
        appended.push(body)
      },
      lastObservation: () => current,
      hasLink: ({ repo, branch }) =>
        appended.some((link) => link.repo === repo.toLowerCase() && link.branch === branch),
    },
    threadId: toThreadId('t'),
    signal: new AbortController().signal,
    repos: async () => ['/w'],
    runId: () => toRunId('r'),
  })
  return {
    linker,
    appended,
    asked,
    observe: (next: BranchObservation) => {
      current = next
    },
  }
}

const found = async (): Promise<FoundPullRequest> => ({
  number: 7,
  url: 'https://github.com/o/r/pull/7',
})

describe('PrLinker', () => {
  it('asks only about non-base branches and links the found pull request', async () => {
    const { linker, appended, asked } = rig({ find: found })
    await linker.link()
    expect(asked).toEqual(['feat-x'])
    expect(appended).toEqual([
      {
        type: 'pull-request-linked',
        number: 7,
        url: 'https://github.com/o/r/pull/7',
        repo: 'acme/web',
        branch: 'feat-x',
        worktreePath: '/wt/feat-x',
      },
    ])
  })

  it('does not ask again until the branch sha changes', async () => {
    const { linker, asked, observe } = rig({})
    await linker.link()
    await linker.link()
    expect(asked).toEqual(['feat-x'])
    observe(
      observation({
        branches: [
          { name: 'main', sha: 'a1' },
          { name: 'feat-x', sha: 'b2' },
        ],
      }),
    )
    await linker.link()
    expect(asked).toEqual(['feat-x', 'feat-x'])
  })

  it('never asks again once a link exists', async () => {
    const { linker, appended, asked, observe } = rig({ find: found })
    await linker.link()
    observe(
      observation({
        branches: [
          { name: 'main', sha: 'a1' },
          { name: 'feat-x', sha: 'b2' },
        ],
      }),
    )
    await linker.link()
    expect(asked).toEqual(['feat-x'])
    expect(appended).toHaveLength(1)
  })

  it('links nothing when the lookup fails, and tries again on the next turn end', async () => {
    let fail = true
    const { linker, appended, asked } = rig({
      find: async () => {
        if (fail) throw new Error('github down')
        return found()
      },
    })
    await linker.link()
    expect(appended).toEqual([])
    fail = false
    await linker.link()
    expect(asked).toEqual(['feat-x', 'feat-x'])
    expect(appended).toHaveLength(1)
  })

  it('skips repos with no github remote and observations without a base', async () => {
    const noRemote = rig({ repoOf: () => null })
    await noRemote.linker.link()
    expect(noRemote.asked).toEqual([])
    const noBase = rig({ observation: observation({ base: undefined }) })
    await noBase.linker.link()
    expect(noBase.asked).toEqual([])
  })

  it('makes at most ten lookups per turn end', async () => {
    const branches = Array.from({ length: 14 }, (_, index) => ({
      name: `b${index}`,
      sha: `s${index}`,
    }))
    const { linker, asked } = rig({
      observation: observation({ branches: [{ name: 'main', sha: 'a1' }, ...branches] }),
    })
    await linker.link()
    expect(asked).toHaveLength(10)
  })
})
