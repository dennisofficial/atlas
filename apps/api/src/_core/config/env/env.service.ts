import { BaseEnvService } from './base-env.service'
import type { IEnvConfig } from './validation'

export class EnvService extends BaseEnvService<IEnvConfig> {}
