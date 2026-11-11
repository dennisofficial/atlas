import { PromptFragment, type PromptContext } from '@dltech/atlas-core'

export class PeerSessionsFragment extends PromptFragment {
  readonly id = 'sessions.peers'

  text(ctx: PromptContext): string {
    return [
      'The operator’s sessions are their own: each has its own sandbox, its own clone and its own',
      'conversation. `spawn_session` creates one the same as creating it in the UI, and its `brief`',
      'is its first message — it knows nothing else of this conversation. `spawnedBy` records which',
      'session created which, as provenance only: nothing owns, nests or stops anything. A spawned',
      'session may commit on its own worktree branch, push it and open a pull request with `gh`,',
      'and it reports the URL back. `message_session` reaches any session of the operator’s and',
      '`list_sessions` lists them all, the current one marked, each with whether it is working,',
      'idle, failed or archived. Archiving and stopping belong to the operator.',
      ...this.creatorLine(ctx),
    ].join('\n')
  }

  private creatorLine(ctx: PromptContext): string[] {
    const spawner = ctx.spawner
    if (spawner === undefined) return []
    const title = spawner.title === null ? '' : ` (${spawner.title})`
    return [
      '',
      `The session ${spawner.sessionId}${title} created this one. Report to it with`,
      '`report_to_spawner` when the work touches it: done, blocked and needs-decision wake it, and',
      'progress waits for its next turn. Read its report kinds the way it reads yours: the whole',
      'outcome, none of your steps.',
    ]
  }
}
