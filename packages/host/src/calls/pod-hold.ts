import { EDaemonAnswer } from '@dltech/atlas-core'

import type { Answers } from './answers'
import { scopeKeyOf } from './call-scope'
import type { DaemonAnswer } from './errors'

export type PodHoldArgs = {
  answers: Answers
  key: string
  ready(): Promise<unknown>
}

export const podAnswerOf = async (args: PodHoldArgs): Promise<DaemonAnswer> => {
  try {
    await args.ready()
  } catch {
    return 'unavailable'
  }
  const answer = await args.answers.ask(args.key)
  if (answer === 'unavailable') return 'unavailable'
  return answer === EDaemonAnswer.Running || answer === EDaemonAnswer.Done
    ? answer
    : EDaemonAnswer.NeverSeen
}

export class PodCalls {
  private readonly tools = new Set<string>()

  constructor(
    private readonly args: {
      answers: Answers
      ready(): Promise<unknown>
    },
  ) {}

  note(tool: string | undefined): void {
    if (tool !== undefined) this.tools.add(tool)
  }

  usesTool(tool: string): boolean {
    return this.tools.has(tool)
  }

  answerFor(args: { runId: string; callId: string }): Promise<DaemonAnswer> {
    return podAnswerOf({
      answers: this.args.answers,
      key: `${scopeKeyOf(args)}.0`,
      ready: () => this.args.ready(),
    })
  }
}
