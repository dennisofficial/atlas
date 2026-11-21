import { PromptFragment } from '@dltech/atlas-core'

export class OperatorInputFragment extends PromptFragment {
  readonly id = 'operator.input'

  text(): string {
    return [
      'When the work needs something that only the operator has, ask with `operator_input` instead of',
      'guessing. That value can be an interactive login, a code, a token or a password. Never ask the',
      'operator to paste it into a message. The ask waits as a card in the thread. The call returns',
      'when the operator answers. The operator answer writes the value to a file and the result names',
      'the path. Read the value from that file and give it to the command that needs it. Never echo the',
      'value into a message, a command line or a file of your own. `operator_shell_input` takes the same',
      'ask and types the value into the stdin of a shell you already started, for a CLI waiting on a',
      'prompt.',
    ].join('\n')
  }
}
