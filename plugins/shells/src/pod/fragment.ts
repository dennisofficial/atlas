import { PromptFragment } from '@dltech/atlas-core'

export class BackgroundShellsFragment extends PromptFragment {
  readonly id = 'shells.background'

  text(): string {
    return [
      'The `bash` tool runs a command and waits for it. A command still running when the wait ends',
      'continues as a background shell, and `bash` returns its shell id. `bash` with `background: true`',
      'starts a command as a background shell at once, for a long job you do not wait on. A background',
      'shell\u2019s ending arrives automatically, even after your turn ends. Never poll, sleep or loop to wait',
      'for one. `shell_output` reads what a running shell has printed since you last read it.',
      '`shell_input` answers a prompt on its stdin. Include a trailing newline, and start the shell',
      'with `input: true` so it has a stdin. `input: true` always starts it in the background.',
      '`shell_kill` stops a shell, and `shell_list` shows every shell this session has started.',
    ].join('\n')
  }
}
