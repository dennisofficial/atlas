import { EDefinitionOrigin } from '@dltech/atlas-core'
import { ECallFailure, ECallStatus, type CallResult } from '@dltech/atlas-protocol'

import {
  EMcpRejection,
  emptySourceRead,
  mergeMcpSources,
  parseMcpRows,
  parseMcpText,
  type McpCloudRow,
  type McpRejection,
  type McpSourceInput,
  type MergedMcp,
} from '../core'

export type McpFileReader = (path: string) => Promise<string | null>

export type McpCloudRead = {
  rows: readonly McpCloudRow[]
  rejections: readonly McpRejection[]
}

export type McpConfigPort = {
  read(session: { sessionId: string }): Promise<McpCloudRead>
}

type Candidate = { text: string | null; error: string | null }

const readCandidate = async (args: { read: McpFileReader; path: string }): Promise<Candidate> => {
  try {
    return { text: await args.read(args.path), error: null }
  } catch (error) {
    return { text: null, error: error instanceof Error ? error.message : String(error) }
  }
}

const repoSource = async (args: {
  read: McpFileReader
  directory: string
  file: string
  compat: boolean
}): Promise<McpSourceInput> => {
  const read = await readCandidate({ read: args.read, path: `${args.directory}/${args.file}` })
  const compat = args.compat ? { compat: true } : {}

  if (read.error !== null) {
    return {
      entries: [],
      rejections: [
        {
          rejection: EMcpRejection.Unreadable,
          name: undefined,
          definedIn: args.file,
          origin: EDefinitionOrigin.Project,
          detail: read.error,
        },
      ],
      ...compat,
    }
  }
  if (read.text === null) return { ...emptySourceRead(), ...compat }

  return {
    ...parseMcpText({
      text: read.text,
      definedIn: args.file,
      origin: EDefinitionOrigin.Project,
      ...(args.compat ? { compat: true } : {}),
    }),
    ...compat,
  }
}

export const loadMcpConfig = async (args: {
  cloud: McpCloudRead
  directory: string | null
  read: McpFileReader
}): Promise<MergedMcp> => {
  const cloud = parseMcpRows({ rows: args.cloud.rows, definedIn: 'the cloud' })
  const sources: McpSourceInput[] = [
    { ...cloud, rejections: [...args.cloud.rejections, ...cloud.rejections] },
  ]
  if (args.directory !== null) {
    sources.push(
      await repoSource({
        read: args.read,
        directory: args.directory,
        file: '.atlas/mcp.json',
        compat: false,
      }),
    )
    sources.push(
      await repoSource({
        read: args.read,
        directory: args.directory,
        file: '.mcp.json',
        compat: true,
      }),
    )
  }
  return mergeMcpSources({ sources })
}

export const fileReaderOf = (args: {
  call: (op: { op: 'readFile'; path: string }) => Promise<CallResult>
}): McpFileReader => {
  return async (path) => {
    const result = await args.call({ op: 'readFile', path })
    if (result.status === ECallStatus.Ok && result.op === 'readFile') return result.value
    if (result.status === ECallStatus.Failed && result.error.code === ECallFailure.NotFound)
      return null
    throw new Error(
      result.status === ECallStatus.Failed ? result.error.message : `could not read ${path}`,
    )
  }
}
