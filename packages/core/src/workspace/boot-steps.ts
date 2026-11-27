export enum EBootStep {
  Provision = 'provision',
  Serve = 'serve',
  Clone = 'clone',
  Setup = 'setup',
  Context = 'context',
  Settings = 'settings',
  Agent = 'agent',
}

export enum EBootStepState {
  Pending = 'pending',
  Running = 'running',
  Done = 'done',
  Error = 'error',
  Interrupted = 'interrupted',
}

export enum EBootStepOutcome {
  Created = 'created',
  Resumed = 'resumed',
  Cloned = 'cloned',
  Reused = 'reused',
  NoRepository = 'no-repository',
  NoSetupScript = 'no-setup-script',
  SetupScriptSkipped = 'setup-script-skipped',
  SetupScriptFailed = 'setup-script-failed',
}

export const BOOT_STEP_ORDER: readonly EBootStep[] = [
  EBootStep.Provision,
  EBootStep.Serve,
  EBootStep.Clone,
  EBootStep.Settings,
  EBootStep.Setup,
  EBootStep.Context,
  EBootStep.Agent,
]
