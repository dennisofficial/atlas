import {
  createAccessMemberApi,
  type AccessMemberApi,
  type AccessScope,
} from '@dltech/atlas-client/settings'

import { api, cloudCall } from '@/lib/api-client'

export type { AccessMemberApi } from '@dltech/atlas-client/settings'

export function accessMemberApiOf(scope: AccessScope): AccessMemberApi {
  const members = createAccessMemberApi({ api, scope })
  return {
    setSecret: (args) => cloudCall(members.setSecret(args)),
    removeSecret: (name) => cloudCall(members.removeSecret(name)),
    revealSecret: (name) => cloudCall(members.revealSecret(name)),
    setFile: (args) => cloudCall(members.setFile(args)),
    removeFile: (path) => cloudCall(members.removeFile(path)),
    revealFile: (path) => cloudCall(members.revealFile(path)),
  }
}
