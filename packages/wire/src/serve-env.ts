import { API_PROVISIONED_ENV } from './boot-progress-wire.js'

/**
 * Injected at `Sandbox.create` and never fetchable afterwards: the session token is minted by the
 * control plane, stored only as a hash, and handed to the client, so creation is the one moment
 * the sandbox can be told what it is serving.
 */
export enum EServeEnv {
  Token = 'ATLAS_SERVE_TOKEN',
  Port = 'ATLAS_SERVE_PORT',
  ThreadId = 'ATLAS_THREAD_ID',
  CloudUrl = 'ATLAS_CLOUD_URL',
  Model = 'ATLAS_MODEL',
}

export const POD_INGRESS_HOST_PORT_ENV = 'ATLAS_POD_INGRESS_HOST_PORT'

export const POD_TELEMETRY_IDENTITY_ENV = 'ATLAS_TELEMETRY_IDENTITY'

/**
 * Container env carries identity and plumbing only, never a setting value: the env settings layer
 * outranks the cloud user and Project layers, so a launching client's snapshot would silently beat
 * scoped config. Both launchers are contract-tested against these lists.
 */
export const POD_ENV_IDENTITY_KEYS: readonly string[] = [
  EServeEnv.Token,
  EServeEnv.Port,
  EServeEnv.ThreadId,
  EServeEnv.CloudUrl,
  'ATLAS_HOME',
  'ATLAS_POD_NAME',
  'ATLAS_SANDBOX_SESSION_ID',
  POD_INGRESS_HOST_PORT_ENV,
  POD_TELEMETRY_IDENTITY_ENV,
  EServeEnv.Model,
]

export const POD_ENV_API_PROVISIONED_KEYS: readonly string[] = [API_PROVISIONED_ENV]

export const POD_ENV_VERCEL_CREDENTIAL_KEYS: readonly string[] = [
  'VERCEL_TOKEN',
  'VERCEL_TEAM_ID',
  'VERCEL_PROJECT_ID',
]

export const FORBIDDEN_POD_ENV_KEYS: readonly string[] = [
  'ATLAS_DECISIONS_URL',
  'ATLAS_DECISIONS_PROVIDER',
  'ATLAS_DECISIONS_MODEL',
  'ATLAS_CLASSIFIER_MODE',
  'ATLAS_SEARCH_BACKEND',
]

/**
 * Workspace and ATLAS_HOME live on the sandbox's own filesystem under /atlas, which
 * `persistent: true` snapshots carry between stops — there is no drive and no mount.
 * /opt/atlas is tooling only (serve binary, lock, stamps, token).
 */
export const SANDBOX_WORKSPACES_PATH = '/atlas/workspaces'
export const SANDBOX_WORKSPACE_PATH = `${SANDBOX_WORKSPACES_PATH}/workspace`
export const SANDBOX_HOME_PATH = '/atlas/home'

export const SERVE_HOME = '/opt/atlas'
export const SERVE_BINARY_PATH = `${SERVE_HOME}/atlas-serve`
/**
 * The release version the baked serve was cut from, written by the image build. The driver's
 * drift probe reads it to decide whether a resumed sandbox predates the pinned image.
 */
export const SERVE_VERSION_PATH = `${SERVE_BINARY_PATH}.version`
/** The CHANNEL_PROTOCOL_VERSION the baked serve speaks, written by the image build; a mismatch rotates the sandbox. */
export const SERVE_PROTOCOL_PATH = `${SERVE_BINARY_PATH}.protocol`
export const SERVE_LOG_PATH = `${SANDBOX_HOME_PATH}/operational/atlas-serve.log`
export const SERVE_LOCK_PATH = `${SERVE_HOME}/atlas-serve.lock`
export const SERVE_TOKEN_PATH = `${SERVE_HOME}/atlas-serve.token`
