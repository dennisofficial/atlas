import { PromptFragment } from '@dltech/atlas-core'

export class OutputShapeFragment extends PromptFragment {
  readonly id = 'output.shape'

  text(): string {
    return [
      'Let the answer take the shape of the question: a small question gets a couple of sentences of',
      'prose; distinct items, steps, or options get a flat list. Tables hold short enumerable facts, with',
      'the explaining around them. Put code in a fence.',
      'Draw a flow, sequence, state machine, or dependency graph that reads better as a picture in a',
      '```mermaid fence; the client renders it as a diagram. Wrap a node label in double quotes when it',
      'holds punctuation such as ()[]{}:;#, and keep sequence-message text to plain words, without',
      'semicolons, # or arrow-like sequences such as -> inside it.',
    ].join('\n')
  }
}

export class CiteFileAndLineFragment extends PromptFragment {
  readonly id = 'output.cite-file-and-line'

  text(): string {
    return [
      'Point at code as path:line, and give the path once rather than every time the name comes up.',
    ].join('\n')
  }
}
