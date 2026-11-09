import { PromptFragment } from '@dltech/atlas-core'

export class PeerSessionsFragment extends PromptFragment {
  readonly id = 'sessions.peers'

  text(): string {
    return [
      'The operator’s sessions are their own by default: each has its own sandbox, its own clone and',
      'its own conversation. `spawn_session` creates one the same as creating it in the UI, and its',
      '`brief` is its first message — it knows nothing else of this conversation. `intoPod: true`',
      'makes it a teammate instead, sharing your sandbox, workspace and context; a teammate cannot',
      'create another teammate. `spawnedBy` records which session created which, as provenance',
      'only: nothing owns, nests or stops anything. `message_session` reaches any session of the',
      'operator’s and `list_sessions` lists them all, the current one marked; archiving and',
      'stopping belong to the operator.',
    ].join('\n')
  }
}
