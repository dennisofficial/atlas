import { PromptFragment } from '@dltech/atlas-core'


export class OutputShapeFragment extends PromptFragment {
  readonly id = 'output.shape'

  text(): string {
    return [
      'Let the answer take the shape of the question: a small question gets a couple of sentences of',
      'prose; distinct items, steps, or options get a flat list. Tables hold short enumerable facts, with',
      'the explaining around them. Put code in a fence.',
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
