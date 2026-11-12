import { PromptFragment, type PromptContext } from '@dltech/atlas-core'

export class PeerSessionsFragment extends PromptFragment {
  readonly id = 'sessions.peers'

  text(ctx: PromptContext): string {
    return [
      'The operator’s sessions are their own: each has its own sandbox, its own clone and its own',
      'conversation. `spawn_session` creates an independent one at the top level, the same as',
      'creating it in the UI, and its `brief` is its first message — it knows nothing else of this',
      'conversation, you are not responsible for it, and `spawnedBy` on it is provenance only.',
      '`spawn_teammate` creates a teammate nested under this session in the sidebar: you write its',
      'brief and it reports back to you, so a workstream under this session is the fan-out shape.',
      'A spawned session may commit on its own worktree branch, push it and open a pull request',
      'with `gh`, and it reports the URL back. `message_session` reaches any session of the',
      'operator’s, `message_teammate` only one of yours, `list_sessions` lists them all with the',
      'current one marked, and `list_teammates` lists just this session’s nested teammates; every',
      'line names whether it is working, idle, failed or archived. Archiving and stopping belong',
      'to the operator.',
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
