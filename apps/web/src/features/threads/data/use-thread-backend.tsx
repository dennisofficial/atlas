'use client'

import { createContext, useContext, type ReactNode } from 'react'

import { cloudThreadBackend, type ThreadBackend } from './thread-backend'

const ThreadBackendContext = createContext<ThreadBackend>(cloudThreadBackend)

export function ThreadBackendProvider(props: { backend: ThreadBackend; children: ReactNode }) {
  return (
    <ThreadBackendContext.Provider value={props.backend}>
      {props.children}
    </ThreadBackendContext.Provider>
  )
}

export const useThreadBackend = (): ThreadBackend => useContext(ThreadBackendContext)
