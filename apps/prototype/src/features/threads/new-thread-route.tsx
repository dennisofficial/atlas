'use client'

import { usePrototype } from '@/proto/use-prototype'

import { NEW_THREAD_CONTROLS, newThreadPropsOf } from './new-thread-tweaks'
import { NewThreadView } from './new-thread-view'

export function NewThreadRoute() {
  const values = usePrototype(NEW_THREAD_CONTROLS)
  return <NewThreadView key={JSON.stringify(values)} {...newThreadPropsOf(values)} />
}
