import { z } from 'zod'

import {
  sandboxProvisionPath,
  sandboxProvisionReplySchema,
  threadMessagePath,
  threadMessageReplySchema,
  wireEventSchema,
  wireThreadSchema,
} from '@dltech/atlas-wire/web'
import { projectSchema } from '@dltech/atlas-wire/web'

import { cloudJson, EHttpMethod } from '@/lib/cloud-api'

const threadPath = (threadId: string) => `/v1/threads/${encodeURIComponent(threadId)}`

const headSchema = z.object({ head: z.number().int() })

export const fetchProjects = () =>
  cloudJson({ method: EHttpMethod.Get, path: '/v1/projects', schema: z.array(projectSchema) })

export const createThread = (args: { projectId: string; title: string }) =>
  cloudJson({
    method: EHttpMethod.Post,
    path: '/v1/threads',
    body: { projectId: args.projectId, title: args.title },
    schema: wireThreadSchema,
  })

export const fetchThread = (threadId: string) =>
  cloudJson({ method: EHttpMethod.Get, path: threadPath(threadId), schema: wireThreadSchema })

export const provisionSandbox = (args: { threadId: string; projectId?: string | undefined }) =>
  cloudJson({
    method: EHttpMethod.Post,
    path: sandboxProvisionPath(args.threadId),
    body: args.projectId === undefined ? {} : { projectId: args.projectId },
    schema: sandboxProvisionReplySchema,
  })

export const postMessage = (args: { threadId: string; sendId: string; text: string }) =>
  cloudJson({
    method: EHttpMethod.Post,
    path: threadMessagePath(args.threadId),
    body: { sendId: args.sendId, text: args.text },
    schema: threadMessageReplySchema,
  })

export const fetchHead = (threadId: string) =>
  cloudJson({
    method: EHttpMethod.Get,
    path: `${threadPath(threadId)}/events/head`,
    schema: headSchema,
  })

export const fetchEvents = (threadId: string) =>
  cloudJson({
    method: EHttpMethod.Get,
    path: `${threadPath(threadId)}/events?own=true`,
    schema: z.array(wireEventSchema),
  })
