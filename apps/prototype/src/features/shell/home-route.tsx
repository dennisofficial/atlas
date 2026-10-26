'use client'

import { usePrototype } from '@/proto/use-prototype'

import { EmptyHome } from './app-shell'
import { SHELL_CONTROLS } from './shell-tweaks'

export function HomeRoute() {
  usePrototype(SHELL_CONTROLS)
  return <EmptyHome />
}
