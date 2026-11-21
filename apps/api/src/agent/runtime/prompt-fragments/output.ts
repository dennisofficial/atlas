import { PromptFragment } from '@dltech/atlas-core'

export class OutputShapeFragment extends PromptFragment {
  readonly id = 'output.shape'

  text(): string {
    return [
      'Match the answer to the question. Answer a small question in one or two sentences of prose.',
      'Put distinct items, steps or options in a flat list. Use a table only for short facts that',
      'enumerate. Write the explanation around the table. Put code in a fence.',
      'Draw a flow, a sequence, a state machine or a dependency graph when the picture is easier to',
      'read than the words. Put the picture in a ```mermaid fence. The client renders the fence as a',
      'diagram. Wrap a node label in double quotes when it holds punctuation such as ()[]{}:;#. Keep',
      'sequence-message text to plain words. Do not use semicolons, # or arrow-like sequences such as',
      '-> in it.',
      'Write math as $$…$$, inline or on its own line. Write a lone $ as plain text, because the client',
      'reads it as a price.',
    ].join('\n')
  }
}

export class CiteFileAndLineFragment extends PromptFragment {
  readonly id = 'output.cite-file-and-line'

  text(): string {
    return [
      'Point at code as path:line. Give the path once, not again each time the name comes up.',
    ].join('\n')
  }
}
