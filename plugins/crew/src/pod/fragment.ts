import { PromptFragment } from '@dltech/atlas-core'

import { CREW_AGENT_TYPES } from '../core'

const types = CREW_AGENT_TYPES.map((type) => `- ${type.name}: ${type.whenToUse}`).join('\n')

export class CrewFragment extends PromptFragment {
  readonly id = 'crew.subagents'

  text(): string {
    return [
      'You can spawn sub-agents with `agent_spawn`. Each one works in the background while you carry',
      'on, and its answer reaches you when it stops. A sub-agent starts with nothing of this',
      'thread, so its brief is the whole of what it knows. Say what to do, where, and what to report',
      'back. A sub-agent you put in a worktree can commit on its own branch, push it and open a',
      'pull request with `gh`. It must report the URL. `send_message` to its id messages one you',
      'started.',
      '`agent_stop` ends one. `agent_list` shows what you have started, and how each one ended.',
      '',
      'When you spawn several sub-agents in one response, they form a group. The harness does not wake',
      'you when one of them ends. It wakes you one time, when the last one ends. Then you get all their',
      'endings together, one notice for each sub-agent. A sub-agent that fails, or that the operator',
      'stops, wakes you at once and the group stays open. A teammate never joins a group. To get the',
      'endings together, spawn all the sub-agents in one response.',
      '',
      'The agent types:',
      types,
    ].join('\n')
  }
}
