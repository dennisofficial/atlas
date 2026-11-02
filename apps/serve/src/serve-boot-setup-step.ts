import { EBootStep, EBootStepOutcome, type BootReporter } from '@dltech/atlas-wire'

import { EContainerSetupResult, type ContainerSetup } from './container-setup'

const SETUP_OUTCOME: Record<EContainerSetupResult, EBootStepOutcome | undefined> = {
  [EContainerSetupResult.None]: EBootStepOutcome.NoSetupScript,
  [EContainerSetupResult.Ran]: undefined,
  [EContainerSetupResult.Skipped]: EBootStepOutcome.SetupScriptSkipped,
  [EContainerSetupResult.Failed]: EBootStepOutcome.SetupScriptFailed,
}

export const trackContainerSetup = (args: {
  reporter: BootReporter
  setup: () => ReturnType<ContainerSetup>
}): Promise<EContainerSetupResult> =>
  args.reporter.track({
    step: EBootStep.Setup,
    work: () => args.setup().catch(() => EContainerSetupResult.Failed),
    outcomeOf: (result) => SETUP_OUTCOME[result],
  })
