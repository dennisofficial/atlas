import { PromptFragment } from '@dltech/atlas-core'

export class BackgroundShellsFragment extends PromptFragment {
  readonly id = 'shells.background'

  text(): string {
    return [
      'The `bash` tool runs a command in the foreground and waits for it. The `shell` tool starts a',
      'command as a background shell that outlives the turn: use it for dev servers, watchers and',
      'anything that will not finish on its own. A background shell\u2019s ending arrives automatically,',
      'even after your turn ends, so never poll, sleep or loop to wait for one. `shell_output` reads',
      'what a shell that will not end on its own has printed since you last read it. `shell_input`',
      'answers a prompt on its stdin (include a trailing newline; start the shell with `input: true`',
      'so it has a stdin). `shell_kill` stops a shell, and `shell_list` shows every shell this',
      'conversation has started.',
    ].join('\n')
  }
}
