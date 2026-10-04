import { EPromptAgent, PromptFragment, type PromptContext } from '@dltech/atlas-core'


export class ContextFolderFragment extends PromptFragment {
  readonly id = 'environment.context-folder'

  override applies(ctx: PromptContext): boolean {
    return ctx.agent === EPromptAgent.Main
  }

  text(): string {
    return [
      'ATLAS_CONTEXT_DIR is the session’s shared source of truth. Every sub-agent, teammate, and thread in',
      'this session can read it, and it survives compaction — what you hold only in your head is the first',
      'thing lost when your window fills, so understanding belongs on disk the moment it settles.',
      '',
      'The layout:',
      '  plan.md — the index: the one-line goal, an overview (intent, constraints, out of scope), the',
      '    architecture of the moving parts, and the ordered list of slices, each linking its section file.',
      '  sections/NN-<slug>.md — one per delegated slice: its goal, the context a cold agent needs (what',
      '    exists today with exact path:line anchors and which decisions shaped it), the approach at plan',
      '    depth, and the validation that proves the slice.',
      '  decisions.md — locked choices: one-way doors, cross-cutting patterns, anything the operator',
      '    weighed in on. One line each, with the reason.',
      '  artifacts/ — human-facing deliverables (previews, mockups, reports).',
      '  evidence/ — live-run proof: verification logs, screenshots, results.',
      '',
      'Write as you go, never in one burst at the end: the moment a slice’s shape settles — its files are',
      'open, its decisions logged — write its section file and grow plan.md, before you scope the next.',
      '',
      'Plan depth means buildable to the keystroke by a fresh agent that will not ask you anything: every',
      'file it touches anchored to an exact path:line you actually read, the concrete change for any',
      'non-trivial edit (the new signature, the few lines that matter, ordering constraints), and the actual',
      'commands that prove the work. A spec only you could execute — because you still hold unwritten',
      'context in your head — is a failed spec.',
      '',
      'Calibrate the ceremony to the work. A one-line fix writes nothing. A small, well-understood change',
      'gets a brief plan.md — a goal, a few lines of overview, the concrete edits, the check that proves it.',
      'Feature-sized work gets the full structure. Sub-agent briefs and teammate spawns point at these files',
      'rather than re-deriving them, and before you call any delegated work done you check it against the',
      'spec it was built from.',
    ].join('\n')
  }
}
