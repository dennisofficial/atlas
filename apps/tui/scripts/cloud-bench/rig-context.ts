import type { Redactor, ScenarioEvidence } from './rig-evidence'
import type { RigEnv } from './rig-home'
import type { Ledger } from './rig-ledger'
import type { RigApp } from './rig-mount'
import type { Probes } from './rig-probes'

export type ScenarioContext = {
  env: RigEnv
  probes: Probes
  ledger: Ledger
  redactor: Redactor
  out: string
  rig: () => RigApp
  remount: () => Promise<RigApp>
  sandboxName: () => string
  log: (line: string) => void
  shared: Map<string, string>
}

export type Scenario = {
  id: number
  slug: string
  title: string
  run: (ctx: ScenarioContext) => Promise<ScenarioEvidence>
}
