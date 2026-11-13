import { PromptFragment } from '@dltech/atlas-core'

export class OperatorInputFragment extends PromptFragment {
  readonly id = 'operator.input'

  text(): string {
    return [
      'When the work needs something only the operator has — an interactive login, a code, a token,',
      'a password — ask with `operator_input` instead of guessing, and never ask them to paste it into',
      'a message. The ask waits as a card in the transcript and the call returns when they answer: the',
      'value is written to a file and the result names the path, so read it from there and hand it to',
      'the command that needs it. Never echo the value into a message, a command line or a file of your',
      'own. `operator_shell_input` takes the same ask and types the value into the stdin of a shell you',
      'already started, for a CLI waiting on a prompt.',
    ].join('\n')
  }
}
