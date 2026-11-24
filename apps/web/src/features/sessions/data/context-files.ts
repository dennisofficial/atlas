'use client'

import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import type { V2Event } from '@dltech/atlas-core'
import type { ContextMirrorListOutput, ContextMirrorReadOutput } from '@dltech/atlas-protocol'

import type { TreeEntry } from '@/features/threads/data/file-tree-source'
import { api, cloudCall } from '@/lib/api-client'

export const contextMirrorKey = (sessionId: string) => ['v2-context-mirror', sessionId] as const

export const contextFileKey = (args: { sessionId: string; path: string }) =>
  ['v2-context-file', args.sessionId, args.path] as const

export const contextFilesKey = (sessionId: string) => ['v2-context-file', sessionId] as const

export type ContextChange = { seq: number; paths: readonly string[] }

export const fetchContextMirror = (sessionId: string): Promise<ContextMirrorListOutput> =>
  cloudCall(api.contextMirror.list.query({ sessionId }))

export const fetchContextFile = (args: {
  sessionId: string
  path: string
}): Promise<ContextMirrorReadOutput> => cloudCall(api.contextMirror.read.query(args))

export const contextTreeOf = (args: {
  files: readonly { path: string }[]
  directory: string
}): TreeEntry[] => {
  const prefix = args.directory === '' ? '' : `${args.directory}/`
  const entries = new Map<string, TreeEntry>()
  for (const file of args.files) {
    if (!file.path.startsWith(prefix)) continue
    const rest = file.path.slice(prefix.length)
    if (rest === '') continue
    const slash = rest.indexOf('/')
    const name = slash === -1 ? rest : rest.slice(0, slash)
    const isDirectory = slash !== -1
    const held = entries.get(name)
    if (held === undefined || (!held.isDirectory && isDirectory)) {
      entries.set(name, { name, isDirectory })
    }
  }
  return [...entries.values()].sort((left, right) =>
    left.isDirectory === right.isDirectory
      ? left.name.localeCompare(right.name)
      : left.isDirectory
        ? -1
        : 1,
  )
}

export const contextChangesOf = (events: readonly V2Event[]): ContextChange | undefined => {
  let seq = 0
  const paths = new Set<string>()
  for (const event of events) {
    if (event.type !== 'context-changed') continue
    if (event.seq > seq) seq = event.seq
    for (const path of event.paths) paths.add(path)
  }
  return seq === 0 ? undefined : { seq, paths: [...paths] }
}

export function useContextMirror(sessionId: string) {
  return useQuery({
    queryKey: contextMirrorKey(sessionId),
    queryFn: () => fetchContextMirror(sessionId),
  })
}

export function useContextFile(args: { sessionId: string; path: string }) {
  return useQuery({
    queryKey: contextFileKey(args),
    queryFn: () => fetchContextFile(args),
  })
}

export function useContextMirrorRefresh(args: {
  sessionId: string
  changed: ContextChange | undefined
  turnEnds: number
}): void {
  const queryClient = useQueryClient()
  const seenChange = useRef<number | undefined>(undefined)
  const seenTurnEnds = useRef<number>(args.turnEnds)
  const { sessionId, changed, turnEnds } = args

  useEffect(() => {
    if (changed === undefined || seenChange.current === changed.seq) return
    seenChange.current = changed.seq
    void queryClient.invalidateQueries({ queryKey: contextMirrorKey(sessionId) })
    for (const path of changed.paths) {
      void queryClient.invalidateQueries({ queryKey: contextFileKey({ sessionId, path }) })
    }
  }, [changed, sessionId, queryClient])

  useEffect(() => {
    if (turnEnds === seenTurnEnds.current) return
    seenTurnEnds.current = turnEnds
    void queryClient.invalidateQueries({ queryKey: contextMirrorKey(sessionId) })
    void queryClient.invalidateQueries({ queryKey: contextFilesKey(sessionId) })
  }, [turnEnds, sessionId, queryClient])
}
