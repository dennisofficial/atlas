import { envConfigValidation } from '../_core/config/env/validation'

export function validateEnvironment(): void {
  const { error } = envConfigValidation.validate(process.env, {
    allowUnknown: true,
    abortEarly: false,
  })
  if (error) {
    throw new Error(`invalid environment:\n${error.message}`)
  }
}
