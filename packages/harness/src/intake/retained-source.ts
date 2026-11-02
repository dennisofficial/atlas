import { retainedSource as agentRetainedSource } from '@dltech/atlas-agent'

import type { IntakeSource, SubmittedInput } from './message-intake'

export const retainedSource = (args: Parameters<typeof agentRetainedSource>[0]): IntakeSource =>
  agentRetainedSource<SubmittedInput>(args)
