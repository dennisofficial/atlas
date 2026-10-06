import type { CapturedFileChange } from '@dltech/atlas-core'

import type { CodeQualityInput } from './task'

export class SourceAdapterUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SourceAdapterUnavailableError'
  }
}

export type ScopePreparation = (args: { change: CapturedFileChange }) => {
  scope: CodeQualityInput['scope']
}

export function buildCodeQualityInput({
  candidate,
  prepareScope,
  policyIds,
}: {
  candidate: { change: CapturedFileChange }
  prepareScope: ScopePreparation | undefined
  policyIds: readonly string[]
}): CodeQualityInput {
  if (prepareScope === undefined) {
    throw new SourceAdapterUnavailableError(
      'code-quality golden datasets require the source-scope adapter (section 02); it is not registered yet',
    )
  }
  return { scope: prepareScope({ change: candidate.change }).scope, policyIds }
}
