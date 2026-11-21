import { PromptFragment } from '@dltech/atlas-core'

import { CREW_AGENT_TYPES } from '../core'

const types = CREW_AGENT_TYPES.map((type) => `- ${type.name}: ${type.whenToUse}`).join('\n')

export class CrewFragment extends PromptFragment {
  readonly id = 'crew.subagents'

  text(): string {
    return [
      'You can spawn sub-agents with `agent_spawn`. Each one works in the background while you carry',
      'on, and its answer reaches you the moment it stops. A sub-agent starts with nothing of this',
      'thread, so its brief is the whole of what it knows. Say what to do, where, and what to report',
      'back. A sub-agent you put in a worktree can commit on its own branch, push it and open a',
      'pull request with `gh`. It must report the URL. `agent_say` messages one you started.',
      '`agent_stop` ends one. `agent_list` shows what you have started, and how each one ended.',
      '',
      'The agent types:',
      types,
    ].join('\n')
  }
}
