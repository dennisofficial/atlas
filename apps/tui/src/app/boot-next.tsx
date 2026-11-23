import { createCliRenderer } from '@opentui/core'
import { createRoot } from '@opentui/react'
import { homedir } from 'node:os'

import { clientVersionHeader } from '../build/info'
import { CrashBoundary } from '../composition/crash-boundary'
import { trackTerminalFocus } from '../composition/terminal-focus'
import { readTerminalSize, settleTerminalSize } from '../composition/terminal-size'
import { kittyImageTransportOf } from '../composition/terminal-image-transport'
import { accountPathOf, apiUrlOf, readAccount } from './account/account-file'
import { AppNext } from './app-next'
import { launchFlagsOf } from './launch-flags'
import { createUrlOpener } from './open-url'

const TARGET_FPS = 120

const EXIT_OK = 0

export async function bootNextAtlas(args: {
  argv: readonly string[]
  env: Record<string, string | undefined>
  cwd: string
  command: string
}): Promise<number> {
  const renderer = await createCliRenderer({
    useMouse: true,
    exitOnCtrlC: false,
    targetFps: TARGET_FPS,
    kittyImageTransport: kittyImageTransportOf({ env: args.env }),
  })

  renderer.setMaxListeners(0)

  const untrackFocus = trackTerminalFocus({
    source: renderer,
    write: (sequence) => process.stdout.write(sequence),
  })
  renderer.once('destroy', untrackFocus)

  const stopSettling = settleTerminalSize({
    read: () => readTerminalSize(process.stdout),
    current: () => ({
      width: renderer.terminalWidth,
      height: renderer.terminalHeight,
    }),
    apply: (size) => renderer.resize(size.width, size.height),
    schedule: (run, delayMs) => {
      const timer = setTimeout(run, delayMs)
      return () => clearTimeout(timer)
    },
  })
  renderer.once('destroy', stopSettling)

  const home = args.env.HOME ?? homedir()
  const accountPath = accountPathOf({ env: args.env, home })
  const account = readAccount({ path: accountPath })
  const openUrl = createUrlOpener()
  const launch = launchFlagsOf({ argv: args.argv })

  const root = createRoot(renderer)
  root.render(
    <CrashBoundary identity={() => ''}>
      <AppNext
        accountPath={accountPath}
        initialAccount={account}
        apiUrl={account?.apiUrl ?? apiUrlOf({ env: args.env })}
        clientVersion={clientVersionHeader()}
        openUrl={openUrl}
        launch={launch}
        cwd={args.cwd}
        onQuit={() => renderer.destroy()}
      />
    </CrashBoundary>,
  )

  renderer.on('destroy', () => process.exit(EXIT_OK))
  return EXIT_OK
}
