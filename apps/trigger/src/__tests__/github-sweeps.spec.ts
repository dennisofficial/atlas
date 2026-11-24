import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it, mock } from 'bun:test'
import { triggerSdkFake } from './trigger-sdk.fake'

mock.module('@trigger.dev/sdk', () => triggerSdkFake)
mock.module('../github/github-sweep-graph', () => ({
  withGithubSweeps: <T>(args: { run: (graph: unknown) => Promise<T> }): Promise<T> => args.run({}),
}))

const { githubHookSweepTask } = await import('../github/github-hook-sweep.task')
const { githubPollSweepTask } = await import('../github/github-poll-sweep.task')
const { githubWebhookReconcileTask } = await import('../github/github-webhook-reconcile.task')
const { runGithubHookSweep, runGithubPollSweep, runGithubWebhookReconcile } = await import(
  '../github/github-sweeps'
)

const recordingHookSweep = (calls: string[]) => ({
  hookSweep: {
    handleSweep: async () => {
      calls.push('hookSweep.handleSweep')
    },
  },
})

const recordingPollSweep = (calls: string[]) => ({
  pollSweeper: {
    handlePoll: async () => {
      calls.push('pollSweeper.handlePoll')
    },
  },
})

const recordingReconcile = (calls: string[]) => ({
  webhookInbox: {
    reviveStarved: async () => {
      calls.push('webhookInbox.reviveStarved')
      return 0
    },
    handleReconcile: async (args: {
      process: (entry: { event: string; payload: unknown }) => Promise<unknown>
    }) => {
      calls.push('webhookInbox.handleReconcile')
      await args.process({ event: 'pull_request', payload: { action: 'opened' } })
    },
    prune: async () => {
      calls.push('webhookInbox.prune')
      return 0
    },
  },
  deliveries: {
    handle: async (args: { event: string; replay?: boolean }) => {
      calls.push(`deliveries.handle:${args.event}:${String(args.replay)}`)
      return { handled: true }
    },
  },
  outbox: {
    drain: async () => {
      calls.push('outbox.drain')
      return 0
    },
    prune: async () => {
      calls.push('outbox.prune')
      return 0
    },
  },
})

describe('the github sweep tasks this worker registers', () => {
  it('keeps the ids, minute crons and retries the api project ran', () => {
    expect(githubHookSweepTask).toMatchObject({
      id: 'github-hook-sweep',
      cron: { pattern: '*/1 * * * *', window: '0m' },
      retry: { maxAttempts: 3 },
    })
    expect(githubPollSweepTask).toMatchObject({
      id: 'github-poll-sweep',
      cron: { pattern: '*/1 * * * *', window: '0m' },
      retry: { maxAttempts: 3 },
    })
    expect(githubWebhookReconcileTask).toMatchObject({
      id: 'github-webhook-reconcile',
      cron: { pattern: '*/1 * * * *', window: '0m' },
      retry: { maxAttempts: 3 },
    })
  })
})

describe('the github sweep runs', () => {
  useTestDatabase()

  it('hands the hook sweep to the hook service alone', async () => {
    const calls: string[] = []

    await runGithubHookSweep(recordingHookSweep(calls))

    expect(calls).toEqual(['hookSweep.handleSweep'])
  })

  it('hands the poll sweep to the poll sweeper alone', async () => {
    const calls: string[] = []

    await runGithubPollSweep(recordingPollSweep(calls))

    expect(calls).toEqual(['pollSweeper.handlePoll'])
  })

  it('reconciles the inbox, drains the outbox and prunes in that order', async () => {
    const calls: string[] = []

    await runGithubWebhookReconcile({
      graph: recordingReconcile(calls),
      now: new Date('2026-11-23T10:00:00Z'),
    })

    expect(calls).toEqual([
      'webhookInbox.reviveStarved',
      'webhookInbox.handleReconcile',
      'deliveries.handle:pull_request:true',
      'webhookInbox.prune',
      'outbox.drain',
      'outbox.prune',
    ])
  })
})
