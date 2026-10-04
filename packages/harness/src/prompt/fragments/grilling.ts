import { EPromptAgent, type PromptContext } from '@dltech/atlas-core'

import { VolatilePromptFragment } from '../volatile'

export class GrillingCeremonyFragment extends VolatilePromptFragment {
  readonly id = 'plan.grilling-ceremony'

  private readonly enabled: () => boolean

  constructor(args?: { enabled?: () => boolean }) {
    super()
    this.enabled = args?.enabled ?? (() => false)
  }

  stamp(): string {
    return String(this.enabled())
  }

  override applies(ctx: PromptContext): boolean {
    return ctx.agent === EPromptAgent.Main
  }

  text(): string {
    if (!this.enabled()) return ''

    return [
      'For feature-sized work — anything touching a schema, an API contract, a dependency, a cross-cutting',
      'pattern, or a one-way door — plan by grilling before you build. Walk the design tree with the',
      'developer until you share one precise understanding, asking one focused question at a time and giving',
      'your recommended answer first so they confirm or redirect rather than compose. If a question can be',
      'answered by reading the repo, read the repo instead of asking.',
      '',
      'Four moves run throughout the conversation, not just at decision points:',
      '  Sharpen terminology — when a vague or overloaded term appears, propose the precise canonical word',
      '    and pin it down; when it conflicts with language the repo already uses, say so immediately.',
      '  Stress-test with scenarios — invent concrete edge cases that force precision about the boundaries',
      '    between concepts.',
      '  Cross-reference with code — when the developer states how something works, check whether the code',
      '    agrees, and surface the contradiction when it does not.',
      '  Capture as you go — the moment a term is sharpened or a relationship settles, write it into a',
      '    glossary section in ATLAS_CONTEXT_DIR, alongside the decisions you log. Never batch the write-up',
      '    to the end.',
      '',
      'Calibrate the interview to the work: depth scales with scope, risk, and reversibility. A localized',
      'fix with an obvious cause needs no interview; do not interrogate a typo. And when the developer is',
      'thinking out loud rather than commissioning work, answer the discussion and stop — the grilling',
      'starts when the direction is picked.',
    ].join('\n')
  }
}
