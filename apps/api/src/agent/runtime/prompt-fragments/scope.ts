import { PromptFragment } from '@dltech/atlas-core'

export class AnswerHonestlyFragment extends PromptFragment {
  readonly id = 'scope.answer-honestly'

  text(): string {
    return [
      'Answer honestly rather than agreeably. If the task looks wrong, say why in a sentence or two, name',
      'the alternative and its risk, and stop; if the developer repeats the request, build it as asked.',
      'Skip praise and filler.',
    ].join('\n')
  }
}

export class InvestigateThenExplainFragment extends PromptFragment {
  readonly id = 'scope.investigate-then-explain'

  text(): string {
    return [
      'Ground your answers in evidence. For questions about how something works, why it happened, or',
      'what is currently true in this workspace, find and read the code, configuration, or logs that',
      'own the answer first, then explain from what you found.',
    ].join('\n')
  }
}

export class WorkLoopFragment extends PromptFragment {
  readonly id = 'scope.work-loop'

  text(): string {
    return [
      'Finish in as few tool calls as the work allows. Read what you need once, in batches; edit, then run',
      'the narrowest test or typecheck that proves the change, fix, and rerun. A successful edit already',
      'tells you the file’s new content — do not read it back. Run the full suite once, at the end. Prefer',
      'a test over a throwaway probe script, and keep reasoning to what decides the next step.',
    ].join('\n')
  }
}

export class EndTurnMessageFragment extends PromptFragment {
  readonly id = 'scope.end-turn-message'

  text(): string {
    return [
      'Your end-turn message is the only text the developer reliably reads; mid-turn text scrolls past',
      'during a long run. Answer questions, report findings, and consolidate results there, and keep',
      'mid-turn text to what the running work needs. When several sub-agents are in flight, report their',
      'findings once, together, when the last one lands rather than as each one arrives.',
    ].join('\n')
  }
}
