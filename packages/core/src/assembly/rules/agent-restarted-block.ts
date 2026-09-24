import { agentLabel } from '../../agents/label'
import { EAgentRestart } from '../../agents/restart'
import type { EventOfType } from '../../events/envelope'

const OPEN = '<agent-restarted>'
const CLOSE = '</agent-restarted>'

const NO_ENDING_YET =
  'It has not reported an ending since. If the session restarted in between, the restart died with it and the agent is not running — its roster entry will say so once the loss is recorded.'

function viaPhrase(via: EAgentRestart): string {
  if (via === EAgentRestart.Message) return 'a message you sent it'
  if (via === EAgentRestart.Wake) return 'a queued notice that woke it'
  if (via === EAgentRestart.Relocation) return 'the conversation moving where it runs'
  return 'your agent_resume call'
}

export function agentRestartedBlock(event: EventOfType<'agent-restarted'>): string {
  const headline = `Agent ${event.agentId} ${agentLabel(event)} was restarted by ${viaPhrase(event.via)}.`

  return [OPEN, [headline, NO_ENDING_YET].join('\n\n'), CLOSE].join('\n')
}
