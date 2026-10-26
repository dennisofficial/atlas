import { useSearchParams } from 'next/navigation'
import { useMemo } from 'react'

import { parseControls } from '@/proto/use-prototype'

import { HOME_PATH, SHELL_CONTROLS, shellDemoOf } from './shell-tweaks'
import type { ShellDemoState } from './shell-types'

const NO_DEMO: ShellDemoState = {}

export function useShellDemo(pathname: string): ShellDemoState {
  const params = useSearchParams()
  const signature = params.toString()
  return useMemo(
    () =>
      pathname === HOME_PATH
        ? shellDemoOf(parseControls({ controls: SHELL_CONTROLS, params }))
        : NO_DEMO,
    [pathname, signature],
  )
}
