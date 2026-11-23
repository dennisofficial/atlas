import { EnvService } from './env.service'
import { envConfigValidation } from './validation'

export function validatedEnvService(
  source: Record<string, string | undefined> = process.env,
): EnvService {
  const { value, error } = envConfigValidation.validate(source, {
    allowUnknown: true,
    abortEarly: false,
  })
  if (error) throw new Error(`invalid environment:\n${error.message}`)
  return new EnvService(value)
}
