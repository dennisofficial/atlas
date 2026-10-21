import * as webWire from '@dltech/atlas-wire/web'

const wireExports = (name: string): boolean => Object.hasOwn(webWire, name)

export type CloudCapabilities = {
  workspaceVercelCredential: boolean
  projectSettings: boolean
  projectWorkspace: boolean
}

export const CLOUD_CAPABILITIES: CloudCapabilities = {
  workspaceVercelCredential: wireExports('workspaceVercelCredentialSchema'),
  projectSettings: wireExports('PROJECT_SETTING_REGISTRY'),
  projectWorkspace: Object.hasOwn(webWire.projectSchema.shape, 'organizationId'),
}

export const AVAILABLE_SOON = 'Available soon'
