import { db } from '@dltech/atlas-db'
import { commitChecksTally } from './github-commit-checks'
import { REST_FIELDS, seedHook, seedSubscription, serviceWith } from './github-delivery.fixture'
import { FILLED_PR_STATE } from './github-delivery.fixture'
import { seedPrState } from '../../../../test/github-seed'
import { vi } from 'bun:test'

export const tallyOf = (headSha: string) =>
  db.transaction((tx) => commitChecksTally({ tx, repoFullName: 'compai/app', headSha }))

export const RUNNING = { status: 'in_progress', conclusion: null, completed_at: null }

export const setupTrackedPr = async (
  readPullRequest = vi.fn(async (..._args: unknown[]) => REST_FIELDS),
) => {
  const harness = serviceWith({ tokens: { 'usr-creator': 'ghu_creator' }, readPullRequest })
  await seedHook({ createdBy: 'usr-creator' })
  await seedSubscription({ userId: 'usr-a', prNumber: 42 })
  await seedPrState({ ...FILLED_PR_STATE, checksRunning: 0, checksPassed: 0, mergeable: null })
  return { ...harness, readPullRequest }
}
