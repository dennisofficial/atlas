import { describe, expect, it } from 'bun:test'

import type { RemoteCalls } from '../../../calls/remote-calls'
import { worktreesOf } from '../../checkouts'
import { hostStepOf } from '../../record/host-step'
import type { CrewRoomArgs } from '../crew-room'
import { BRIEF, PARENT, ofType, rigOf, spawnInStep } from './spawn-step-rig'

const NAME = 'topic'
const WORKTREE_PATH = `/work/.atlas/worktrees/${NAME}`
const MAIN_HEAD = '1'.repeat(40)
const BRANCH_HEAD = '2'.repeat(40)

const listingOf = (created: boolean): string =>
  [
    'worktree /work',
    `HEAD ${MAIN_HEAD}`,
    'branch refs/heads/main',
    '',
    ...(created
      ? [`worktree ${WORKTREE_PATH}`, `HEAD ${BRANCH_HEAD}`, `branch refs/heads/${NAME}`, '']
      : []),
  ].join('\n')

const callsOf = (state: { created: boolean }): RemoteCalls =>
  ({
    invoke: async (call: {
      op: { op?: string; argv?: readonly string[] }
      onOutput?: (bytes: Uint8Array) => void
    }) => {
      if (call.op.op !== 'exec') return { status: 'ok', value: undefined }
      const argv = (call.op.argv ?? []).join(' ')
      let stdout = ''
      if (argv === 'git worktree list --porcelain') stdout = listingOf(state.created)
      if (argv === 'git symbolic-ref --quiet --short refs/remotes/origin/HEAD')
        stdout = 'origin/main\n'
      if (argv.startsWith('git worktree add ')) state.created = true
      if (stdout !== '') call.onOutput?.(new TextEncoder().encode(stdout))
      return { status: 'ok', key: 'k', op: 'exec', value: { exitCode: 0, outcome: 'exited' } }
    },
  }) as unknown as RemoteCalls

describe('a spawn into a named worktree, replayed in one tool call', () => {
  it('keeps one child when the worktree reopen drops its create-only fields', async () => {
    const { room, parent } = await rigOf()
    const args = Reflect.get(room, 'args') as CrewRoomArgs
    const worktrees = worktreesOf({
      calls: callsOf({ created: false }),
      step: (request) =>
        hostStepOf({
          record: parent.record,
          threadId: PARENT,
          runId: () => args.deps.ids.nextRunId(),
          ...request,
        }),
    })
    const spawn = () =>
      spawnInStep(async () => {
        const worktree = await worktrees.create({ cwd: '/work', name: NAME })
        return await room.spawn({
          agentType: 'general-purpose',
          intent: 'probe',
          prompt: BRIEF,
          worktree,
        })
      })
    try {
      const first = await spawn()
      const replay = await spawn()

      expect(replay.agentId).toBe(first.agentId)
      expect(replay.worktree).toEqual({ path: WORKTREE_PATH, branch: NAME })
      expect(ofType(parent.events, 'agent-spawned')).toHaveLength(1)
    } finally {
      await room.stopAll()
    }
  })
})
