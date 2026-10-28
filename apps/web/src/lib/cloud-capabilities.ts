import * as webWire from '@dltech/atlas-wire/web'

const wireExports = (name: string): boolean => Object.hasOwn(webWire, name)

export type CloudCapabilities = {
  userVercelCredential: boolean
}

export const CLOUD_CAPABILITIES: CloudCapabilities = {
  userVercelCredential: wireExports('userVercelCredentialSchema'),
}

export const AVAILABLE_SOON = 'Available soon'
