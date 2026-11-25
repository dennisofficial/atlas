import { GithubConfig, GithubDeviceClient, GithubService } from '@dltech/atlas-github'

import type { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { GroupsService } from '../project-groups/project-groups.service'
import { ProjectsService } from '../projects/projects.service'
import { McpServersService } from './mcp-servers.service'

const refuseFetch = async (): Promise<Response> => {
  throw new Error('these specs never call GitHub')
}

export const mcpServersServiceOf = (cipher: SecretCipherService): McpServersService => {
  const github = new GithubService(
    cipher,
    new GithubConfig({ clientId: 'spec-client' }),
    new GithubDeviceClient({ fetchFn: refuseFetch }),
  )
  const projects = new ProjectsService(github)
  return new McpServersService(cipher, projects, new GroupsService(projects))
}
