import { PromptFragment } from '@dltech/atlas-core'

export class PeerSessionsFragment extends PromptFragment {
  readonly id = 'sessions.peers'

  text(): string {
    return [
      'Peer sessions are full sessions the operator owns, not sub-agents: each one keeps its own',
      'conversation, appears in the operator sidebar and runs on its own. Start one with',
      '`spawn_session`, whose `brief` is the whole of what it knows — it sees nothing of this',
      'conversation. Peers share this sandbox and this workspace, so a file you write is there for',
      'them and a port they expose is one you can reach. `message_session` sends one a message and',
      'reaches any session of the operator’s, spawned by you or not; `list_sessions` shows the',
      'session that spawned you and the ones you spawned, and never archive or stop a peer: they',
      'are the operator to close.',
    ].join('\n')
  }
}
