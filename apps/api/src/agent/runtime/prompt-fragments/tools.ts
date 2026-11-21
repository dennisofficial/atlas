import { PromptFragment } from '@dltech/atlas-core'

import { pathEnvironmentNote } from '../../agent-tools/file-text'

export class PreferDedicatedToolsFragment extends PromptFragment {
  readonly id = 'tools.prefer-dedicated'

  text(): string {
    return [
      'Use the file tools to read, search and edit files. The Atlas harness then records each read and',
      'shows the change to the operator.',
    ].join('\n')
  }
}

export class ParallelToolCallsFragment extends PromptFragment {
  readonly id = 'tools.parallel-calls'

  text(): string {
    return 'Batch independent read-only tool calls in the same response.'
  }
}

export class PathEnvironmentFragment extends PromptFragment {
  readonly id = 'tools.path-environment'

  text(): string {
    return pathEnvironmentNote
  }
}
