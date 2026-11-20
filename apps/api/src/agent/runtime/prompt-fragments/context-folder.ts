import { EPromptGroup, PromptFragment, type PromptContext } from '@dltech/atlas-core'

import { ATLAS_CONTEXT_DIR_ENV } from '../session-paths'

export class ContextFolderFragment extends PromptFragment {
  readonly id = 'environment.context-folder'

  override applies(ctx: PromptContext): boolean {
    return ctx.groups.includes(EPromptGroup.ContextFolder)
  }

  text(): string {
    return [
      `${ATLAS_CONTEXT_DIR_ENV} is the shared source of truth for the session. You, every sub-agent and`,
      'every teammate in the session can read it. The folder survives compaction. What you hold only in',
      'your head is the first thing lost when the context window fills, so write understanding to disk',
      'the moment it settles.',
      '',
      'The layout:',
      '  plan.md — the index: the one-line goal, an overview (intent, constraints, out of scope), the',
      '    architecture of the parts involved, and the ordered list of slices. Each slice links its',
      '    section file.',
      '  sections/NN-<slug>.md — one per delegated slice: its goal, the context a new sub-agent needs,',
      '    the approach at plan depth, and the validation that proves the slice. The context gives what',
      '    exists today with exact path:line anchors, and the decisions that shaped it.',
      '  decisions.md — settled choices: irreversible decisions, shared patterns and decisions the',
      '    operator helped make. Write one line for each choice, with the reason.',
      '  artifacts/ — deliverables the operator reads (previews, mockups, reports).',
      '  evidence/ — proof from a live run: verification logs, screenshots, results.',
      '',
      'Write these files when the work is split across sub-agents or teammates. Write them when the',
      'work will outlive your context window. Work you do alone in one sitting needs none.',
      '',
      'Write as you go. Never write everything in one burst at the end. When the shape of a slice',
      'settles, and its files are open and its decisions logged, write its section file and grow',
      'plan.md. Do that before you scope the next slice.',
      '',
      'Plan depth means a new sub-agent can build the slice without asking you anything. For every file',
      'the sub-agent will touch, include an exact path:line that you read. For each non-trivial edit,',
      'specify the concrete change. Include the new signature, the important lines and the ordering',
      'constraints. Include the commands that prove the work. A spec that only you could execute is a',
      'failed spec, because you still hold unwritten context in your head.',
      '',
      'A sub-agent brief and a teammate spawn point at these files instead of deriving them again.',
      'Before you call delegated work done, check it against the spec it was built from.',
    ].join('\n')
  }
}
