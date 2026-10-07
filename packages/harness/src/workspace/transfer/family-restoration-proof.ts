import { verifyFamilyRestoration as verifyInCore } from '@dltech/atlas-core'

import type { RestoredWorkspace, WorkspaceManifest } from './manifest'

export function verifyFamilyRestoration(args: { manifest: WorkspaceManifest; restored: RestoredWorkspace }): void {
  verifyInCore({ manifest: args.manifest, restored: args.restored })
}
