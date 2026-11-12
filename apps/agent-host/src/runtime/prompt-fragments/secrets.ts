import { envSecretsNoticeOf } from '../env-secrets'
import { VolatilePromptFragment } from './volatile'

export class EnvSecretsFragment extends VolatilePromptFragment {
  readonly id = 'env-secrets'

  constructor(private readonly names: () => readonly string[]) {
    super()
  }

  stamp(): string {
    return this.names().join(',')
  }

  text(): string {
    return envSecretsNoticeOf(this.names()) ?? ''
  }
}
