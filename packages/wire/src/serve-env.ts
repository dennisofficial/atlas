/** Carries the served binary's own sha256 so the sandbox can verify what it downloaded byte-for-byte. */
export const SERVE_BINARY_SHA256_HEADER = 'x-atlas-serve-sha256'

export class StaleSandboxTokenError extends Error {
  constructor() {
    super('the sandbox carries a serve token this deployment no longer recognizes')
    this.name = 'StaleSandboxTokenError'
  }
}

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
  FactoryRole = 'ATLAS_FACTORY_ROLE',
  DecisionsUrl = 'ATLAS_DECISIONS_URL',
}

export const SERVE_HOME = '/opt/atlas'
export const SERVE_BINARY_PATH = `${SERVE_HOME}/atlas-serve`
export const SERVE_NEXT_BINARY_PATH = `${SERVE_BINARY_PATH}.next`
export const SERVE_STAMP_PATH = `${SERVE_BINARY_PATH}.stamp`
export const SERVE_LOG_PATH = `${SERVE_HOME}/atlas-serve.log`
export const SERVE_LOCK_PATH = `${SERVE_HOME}/atlas-serve.lock`
export const SERVE_TOKEN_PATH = `${SERVE_HOME}/atlas-serve.token`
export const SERVE_HEADERS_PATH = `${SERVE_HOME}/atlas-serve.headers`
