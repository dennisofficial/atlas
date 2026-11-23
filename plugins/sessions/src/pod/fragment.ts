import { PromptFragment, type PromptContext } from '@dltech/atlas-core'

export class PeerSessionsFragment extends PromptFragment {
  readonly id = 'sessions.peers'

  text(ctx: PromptContext): string {
    return [
      'The operator’s sessions are independent. Each one has its own sandbox, its own clone and its',
      'own threads. `spawn_session` creates an independent session at the top level, the same as',
      'the new-session button in the UI. Its `brief` is its first message. It knows nothing else of',
      'this session, you are not responsible for it, and `spawnedBy` on it is provenance only.',
      '`spawn_teammate` creates a teammate nested under this session in the sidebar. You write its',
      'brief, and it reaches you with `send_message`, so a workstream under this session takes the',
      'shape of a fan-out. Either spawn tool takes `files`: paths under $ATLAS_CONTEXT_DIR, which are',
      'copied into the spawned session’s own context folder before its first turn. A spawned session',
      'can commit on its own worktree branch, push it and open',
      'a pull request with `gh`. It reports back only when its brief asks. `send_message` reaches any agent or session',
      'of the operator’s by its id, and "parent" reaches whoever started you. `list_sessions` lists',
      'every session with the current one marked. `list_teammates` lists only this session’s nested',
      'teammates. Every line names whether the session is working, idle, failed or archived.',
      '`archive_session` archives a session this one spawned, such as a teammate, once its work is',
      'done. The operator can unarchive it. Stopping belongs to the operator.',
      ...this.creatorLine(ctx),
    ].join('\n')
  }

  private creatorLine(ctx: PromptContext): string[] {
    const spawner = ctx.spawner
    if (spawner === undefined) return []
    const title = spawner.title === null ? '' : ` (${spawner.title})`
    return [
      '',
      `The session ${spawner.sessionId}${title} created this one. It is the origin of this session,`,
      'not its owner. Report the outcome to the operator in your own thread. Message it with',
      '`send_message` to "parent" only when the brief asks for a reply or you need something from it.',
      'Then carry the whole outcome, none of your steps: none of them are in its history. Never',
      'message it after it is archived.',
    ]
  }
}
