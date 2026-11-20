import { PromptFragment, type PromptContext } from '@dltech/atlas-core'

export class PeerSessionsFragment extends PromptFragment {
  readonly id = 'sessions.peers'

  text(ctx: PromptContext): string {
    return [
      'The operator’s sessions are independent. Each one has its own sandbox, its own clone and its',
      'own transcript. `spawn_session` creates an independent session at the top level, the same as',
      'the new-session button in the UI. Its `brief` is its first message. It knows nothing else of',
      'this session, you are not responsible for it, and `spawnedBy` on it is provenance only.',
      '`spawn_teammate` creates a teammate nested under this session in the sidebar. You write its',
      'brief, and it reports back to you, so a workstream under this session takes the shape of a',
      'fan-out. A spawned session can commit on its own worktree branch, push it and open a pull',
      'request with `gh`. It reports the URL back. `message_session` reaches any session of the',
      'operator’s. `message_teammate` reaches only one of yours. `list_sessions` lists them all with',
      'the current one marked. `list_teammates` lists only this session’s nested teammates. Every',
      'line names whether the session is working, idle, failed or archived. Archiving and stopping',
      'belong to the operator.',
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
      '`report_to_spawner` when the work touches it. done, blocked and needs-decision wake it, and',
      'progress waits for its next turn. Read its report kinds the way it reads yours: the whole',
      'outcome, none of your steps.',
    ]
  }
}
