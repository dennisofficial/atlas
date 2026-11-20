export const API_PROVISIONED_ENV = 'ATLAS_API_PROVISIONED'
export const POD_NAME_ENV = 'ATLAS_POD_NAME'

type TEnv = Record<string, string | undefined>

const present = (value: string | undefined): boolean => value !== undefined && value.trim() !== ''

export const isApiProvisioned = (env: TEnv): boolean => env[API_PROVISIONED_ENV] === '1'

export const writesBehind = (env: TEnv): boolean =>
  isApiProvisioned(env) || (present(env.ATLAS_CLOUD_URL) && present(env.ATLAS_SERVE_TOKEN))

export const isLocalPod = (env: TEnv): boolean => present(env[POD_NAME_ENV])

export const mirrorsThreadState = (env: TEnv): boolean => writesBehind(env) && !isLocalPod(env)
