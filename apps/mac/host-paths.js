import { existsSync } from 'node:fs'
import { join } from 'node:path'

export class HostMissingError extends Error {
  constructor(script) {
    super(`the desktop host is missing at ${script}`)
    this.name = 'HostMissingError'
    this.script = script
  }
}

export function resolveHostScript({ env, resourcesPath, appRoot }) {
  if (env.ATLAS_HOST_SCRIPT) return env.ATLAS_HOST_SCRIPT
  if (resourcesPath) {
    const bundled = join(resourcesPath, 'app', 'host.js')
    if (existsSync(bundled)) return bundled
  }
  const dev = join(appRoot, '..', 'mac', 'src', 'desktop-host', 'index.ts')
  if (existsSync(dev)) return dev
  throw new HostMissingError(dev)
}

export function resolveBun({ env, resourcesPath }) {
  if (env.ATLAS_BUN) return env.ATLAS_BUN
  if (resourcesPath) {
    const bundled = join(resourcesPath, 'bin', 'bun')
    if (existsSync(bundled)) return bundled
  }
  return 'bun'
}

export function webRootAt({ resourcesPath }) {
  return join(resourcesPath, 'web-standalone', 'apps', 'web')
}

export function hostEnvironment({ base, paneOrigin, updateOrigin, webRoot, appVersion }) {
  const environment = { ...base }
  if (paneOrigin) environment.ATLAS_PANE_ORIGIN = paneOrigin
  if (updateOrigin) environment.ATLAS_UPDATE_ORIGIN = updateOrigin
  if (webRoot) environment.ATLAS_WEB_ROOT = webRoot
  if (appVersion) environment.ATLAS_VERSION = appVersion
  return environment
}

export function sessionUrlIn(output) {
  for (const line of output.split('\n')) {
    if (line.startsWith('ATLAS_URL=')) return line.slice('ATLAS_URL='.length).trim()
  }
  return undefined
}
