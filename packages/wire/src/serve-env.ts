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
  WorkspaceDir = 'ATLAS_WORKSPACE_DIR',
  Model = 'ATLAS_MODEL',
  DecisionsUrl = 'ATLAS_DECISIONS_URL',
  DecisionsProvider = 'ATLAS_DECISIONS_PROVIDER',
  DecisionsModel = 'ATLAS_DECISIONS_MODEL',
}

export const SERVE_HOME = '/opt/atlas'
export const SERVE_BINARY_PATH = `${SERVE_HOME}/atlas-serve`
/**
 * The release version the baked serve was cut from, written by the image build. The driver's
 * drift probe reads it to decide whether a resumed sandbox predates the pinned image.
 */
export const SERVE_VERSION_PATH = `${SERVE_BINARY_PATH}.version`
/** The CHANNEL_PROTOCOL_VERSION the baked serve speaks, written by the image build; a mismatch rotates the sandbox. */
export const SERVE_PROTOCOL_PATH = `${SERVE_BINARY_PATH}.protocol`
export const SERVE_LOG_PATH = '/atlas/home/operational/atlas-serve.log'
export const LEGACY_SERVE_LOG_PATH = `${SERVE_HOME}/atlas-serve.log`
export const SERVE_LOCK_PATH = `${SERVE_HOME}/atlas-serve.lock`
export const SERVE_TOKEN_PATH = `${SERVE_HOME}/atlas-serve.token`
