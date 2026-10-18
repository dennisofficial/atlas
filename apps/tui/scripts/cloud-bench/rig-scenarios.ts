import type { Scenario } from './rig-context'
import { apiWakeScenario } from './rig-scenario-api-wake'
import { freshScenario } from './rig-scenario-fresh'
import { parkScenario } from './rig-scenario-park'
import { swapScenario } from './rig-scenario-swap'
import { wakeCmdScenario } from './rig-scenario-wake-cmd'
import { wakeSendScenario } from './rig-scenario-wake-send'

export const SCENARIOS: Scenario[] = [
  freshScenario,
  parkScenario,
  wakeSendScenario,
  wakeCmdScenario,
  swapScenario,
  apiWakeScenario,
]
