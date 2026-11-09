import { PromptFragment } from '@dltech/atlas-core'

export class ServicesFragment extends PromptFragment {
  readonly id = 'services.lifecycle'

  text(): string {
    return [
      '`service_start` runs a long-running service - a dev server, a database, a cache - that keeps',
      'running until it is stopped and outlives the turn. A service\u2019s ending arrives automatically,',
      'even after your turn ends, so never poll, sleep or loop to wait for one. After you edit what a',
      'service runs, `service_restart` it. `service_stop` stops one, and `service_list` shows every',
      'service this conversation has started. A `name` comes from the project\u2019s `.atlas/services.yaml`:',
      'it starts what that service needs first and uses its command, working directory, env and port.',
      'A service whose declaration changed since it started is listed as stale until you restart it.',
      'A service with a port is published at a public URL that the tool returns: hand the user that URL,',
      'which is what they open. A service without a port is reachable only inside the sandbox.',
    ].join('\n')
  }
}
