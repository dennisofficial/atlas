import { PromptFragment } from '@dltech/atlas-core'

export class ServicesFragment extends PromptFragment {
  readonly id = 'services.lifecycle'

  text(): string {
    return [
      '`service_start` runs a long-running service - a dev server, a database, a cache - that keeps',
      'running until it is stopped and outlives the turn. A service\u2019s ending arrives automatically,',
      'even after your turn ends, so never poll, sleep or loop to wait for one. After you edit what a',
      'service runs, `service_restart` it. `service_stop` stops one, and `service_list` shows every',
      'service this conversation has started. Services declared in `.atlas/services.yaml` are not',
      'started by name yet: pass `service_start` the command yourself.',
    ].join('\n')
  }
}
