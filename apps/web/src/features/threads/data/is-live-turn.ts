import { EAgentStatus } from '@dltech/atlas-core'

import { ETurnKind, type Turn } from './transcript-turns'

export const isLiveTurn = (turn: Turn): boolean =>
  turn.kind === ETurnKind.Agent &&
  (turn.running || turn.spawns.some((spawn) => spawn.status === EAgentStatus.Running))
