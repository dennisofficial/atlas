import { PromptFragment } from '@dltech/atlas-core'

export class ServicesFragment extends PromptFragment {
  readonly id = 'services.lifecycle'

  text(): string {
    return [
      '`service` with action `start` runs a long-running service - a dev server, a database, a cache -',
      'that keeps running until it is stopped and outlives the turn. A service\u2019s ending arrives',
      'automatically, even after your turn ends. Never poll, sleep or loop to wait for one. After you',
      'edit what a service runs, call `service` with action `restart`. Action `stop` stops one, and action',
      '`list` shows every service this session has started. A `name` comes from the project\u2019s',
      '`.atlas/services.yaml`: it starts what that service needs first and uses its command, working',
      'directory, env and port. A service whose declaration changed since it started is listed as stale',
      'until you restart it. A service with a port is published at a public URL that the tool returns.',
      'Give the operator that URL, because it is what they open. A service without a port is reachable',
      'only inside the sandbox.',
      '',
      'Start every dev server, watcher or other long-running process by name from',
      '`.atlas/services.yaml`, with `service` action `start` and `name`. If the project has no',
      'declaration that fits, add one to `.atlas/services.yaml` - command, working directory, port,',
      'setup, needs, env - and start it by name instead of running it ad hoc. Use `service` with a',
      '`command` only for a one-off. Never keep a server alive with bash `&`, `nohup`,',
      '`runInBackground` or a raised bash `timeoutMs`.',
    ].join('\n')
  }
}
