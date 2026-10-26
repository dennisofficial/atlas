import {
  registeredPortToken,
  instanceCachingFactory,
  type DependencyContainer,
} from '../container/injection'
import { WorkspaceRoot } from '../container/tokens'

import { GitChangesPort } from './git-changes.port'
import { LocalGitChanges } from './local-git-changes'

export function registerChanges({ container }: { container: DependencyContainer }): void {
  container.register(registeredPortToken(GitChangesPort), {
    useFactory: instanceCachingFactory(
      (resolver) => new LocalGitChanges({ root: resolver.resolve(WorkspaceRoot) }),
    ),
  })
}
