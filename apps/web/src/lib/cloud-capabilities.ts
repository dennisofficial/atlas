import * as webWire from '@dltech/atlas-wire/web'

const wireExports = (name: string): boolean => Object.hasOwn(webWire, name)

export type CloudCapabilities = {
  workspaceVercelCredential: boolean
  userVercelCredential: boolean
  projectWorkspace: boolean
}

export const CLOUD_CAPABILITIES: CloudCapabilities = {
  workspaceVercelCredential: wireExports('workspaceVercelCredentialSchema'),
  userVercelCredential: wireExports('userVercelCredentialSchema'),
  projectWorkspace: Object.hasOwn(webWire.projectSchema.shape, 'organizationId'),
}

export const AVAILABLE_SOON = 'Available soon'
