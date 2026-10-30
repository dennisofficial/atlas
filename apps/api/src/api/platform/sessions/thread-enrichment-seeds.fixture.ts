import { db } from '@dltech/atlas-db'
import { seedEventRow, seedThreadRow } from '../../../../test/session-seed'
import { REFERENCE_CHAIN_LIMIT } from './fork-chain'

const pullRequestBody = (number: number) =>
  JSON.stringify({
    number,
    url: `https://github.com/x/y/pull/${number}`,
    repo: 'x/y',
    branch: `branch-${number}`,
  })

export const linkPullRequest = (args: { threadId: string; seq: number; number: number }) =>
  seedEventRow({
    threadId: args.threadId,
    seq: args.seq,
    type: 'pull-request-linked',
    body: pullRequestBody(args.number),
  })

export const enterWorktree = (args: { threadId: string; seq: number; name: string }) =>
  seedEventRow({
    threadId: args.threadId,
    seq: args.seq,
    type: 'worktree-entered',
    body: JSON.stringify({ path: `/wt/${args.name}`, branch: args.name }),
  })

export async function seedMixed(): Promise<string[]> {
  await seedThreadRow({ id: 'plain' })
  await seedThreadRow({ id: 'own' })
  await enterWorktree({ threadId: 'own', seq: 1, name: 'own-a' })
  await linkPullRequest({ threadId: 'own', seq: 2, number: 1 })
  await seedThreadRow({ id: 'exited' })
  await enterWorktree({ threadId: 'exited', seq: 1, name: 'gone' })
  await seedEventRow({
    threadId: 'exited',
    seq: 2,
    type: 'worktree-exited',
    body: '{}',
  })
  await seedThreadRow({ id: 'base' })
  await enterWorktree({ threadId: 'base', seq: 1, name: 'base-a' })
  await enterWorktree({ threadId: 'base', seq: 5, name: 'base-late' })
  await linkPullRequest({ threadId: 'base', seq: 2, number: 2 })
  await linkPullRequest({ threadId: 'base', seq: 6, number: 3 })
  await seedThreadRow({
    id: 'fork',
    parentThreadId: 'base',
    forkSeq: 3,
    forkMode: 'reference',
  })
  await seedThreadRow({
    id: 'fork2',
    parentThreadId: 'fork',
    forkSeq: 2,
    forkMode: 'reference',
  })
  await seedThreadRow({
    id: 'copy',
    parentThreadId: 'base',
    forkSeq: 3,
    forkMode: 'copy',
  })
  await seedThreadRow({ id: 'parent', workspace: '/repo' })
  await linkPullRequest({ threadId: 'parent', seq: 1, number: 7 })
  await seedThreadRow({ id: 'mate', spawnerThreadId: 'parent', title: 'mate' })
  await linkPullRequest({ threadId: 'mate', seq: 1, number: 7 })
  await linkPullRequest({ threadId: 'mate', seq: 2, number: 8 })
  await seedThreadRow({ id: 'grand', spawnerThreadId: 'mate' })
  await linkPullRequest({ threadId: 'grand', seq: 1, number: 9 })
  return ['plain', 'own', 'exited', 'base', 'fork', 'fork2', 'copy', 'parent', 'mate', 'grand']
}

export const linkFork = (args: { id: string; parentThreadId: string; forkSeq: number }) =>
  db.orm.public.Thread.where({ id: args.id }).update({
    parentThreadId: args.parentThreadId,
    forkSeq: args.forkSeq,
    forkMode: 'reference',
  })

export async function seedChain(args: { prefix: string; links: number }): Promise<string> {
  const tail = `${args.prefix}${args.links}`
  await seedThreadRow({ id: tail })
  await enterWorktree({ threadId: tail, seq: 1, name: args.prefix })
  await linkPullRequest({ threadId: tail, seq: 2, number: 50 })
  for (let index = args.links - 1; index >= 0; index -= 1) {
    await seedThreadRow({
      id: `${args.prefix}${index}`,
      parentThreadId: `${args.prefix}${index + 1}`,
      forkSeq: 5,
      forkMode: 'reference',
    })
  }
  return `${args.prefix}0`
}

export async function seedEdges(): Promise<string[]> {
  const limit = await seedChain({
    prefix: 'lim',
    links: REFERENCE_CHAIN_LIMIT,
  })
  const over = await seedChain({
    prefix: 'over',
    links: REFERENCE_CHAIN_LIMIT + 1,
  })
  await seedThreadRow({ id: 'cycA' })
  await seedThreadRow({ id: 'cycB' })
  await linkFork({ id: 'cycA', parentThreadId: 'cycB', forkSeq: 4 })
  await linkFork({ id: 'cycB', parentThreadId: 'cycA', forkSeq: 4 })
  await seedThreadRow({ id: 'trunk' })
  await enterWorktree({ threadId: 'trunk', seq: 1, name: 'trunk-a' })
  await enterWorktree({ threadId: 'trunk', seq: 5, name: 'trunk-late' })
  await linkPullRequest({ threadId: 'trunk', seq: 2, number: 20 })
  await linkPullRequest({ threadId: 'trunk', seq: 6, number: 21 })
  await seedThreadRow({
    id: 'mid',
    parentThreadId: 'trunk',
    forkSeq: 3,
    forkMode: 'reference',
  })
  await seedThreadRow({
    id: 'tip',
    parentThreadId: 'mid',
    forkSeq: 10,
    forkMode: 'reference',
  })
  await seedThreadRow({
    id: 'hider',
    parentThreadId: 'trunk',
    forkSeq: 3,
    forkMode: 'reference',
  })
  await enterWorktree({ threadId: 'hider', seq: 4, name: 'hider-own' })
  await linkPullRequest({ threadId: 'hider', seq: 3, number: 30 })
  await seedThreadRow({
    id: 'hiderChild',
    parentThreadId: 'hider',
    forkSeq: 4,
    forkMode: 'reference',
  })
  return [limit, over, 'cycA', 'cycB', 'trunk', 'mid', 'tip', 'hider', 'hiderChild']
}
