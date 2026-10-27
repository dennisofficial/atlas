import { registerDisposable } from '../container/disposal'
import {
  registeredPortToken,
  instanceCachingFactory,
  type DependencyContainer,
} from '../container/injection'
import { WorkspaceRoot } from '../container/tokens'

import { BunTerminalPort } from './bun-terminal'
import { TerminalPort } from './terminal.port'

export function registerTerminal({ container }: { container: DependencyContainer }): void {
  let live: BunTerminalPort | undefined

  container.register(registeredPortToken(TerminalPort), {
    useFactory: instanceCachingFactory((resolver) => {
      live = new BunTerminalPort({ root: resolver.resolve(WorkspaceRoot) })
      return live
    }),
  })

  registerDisposable({
    container,
    close: async () => {
      await live?.closeAll()
    },
  })
}
