import { z } from 'zod'

import { createThreadReplySchema, wireEventSchema, wireThreadSchema } from '@dltech/atlas-wire/web'
import { projectSchema } from '@dltech/atlas-wire/web'

import { api, cloudCall } from '@/lib/api-client'
import { cloudJson, cloudSend, EHttpMethod } from '@/lib/cloud-api'

import type { CreateThreadBody } from './create-thread'

const threadPath = (threadId: string) => `/v1/threads/${encodeURIComponent(threadId)}`

const headSchema = z.object({ head: z.number().int() })

export const fetchProjects = () =>
  cloudJson({ method: EHttpMethod.Get, path: '/v1/projects', schema: z.array(projectSchema) })

export const fetchThreads = (projectId: string) =>
  cloudJson({
    method: EHttpMethod.Get,
    path: `/v1/threads?projectId=${encodeURIComponent(projectId)}`,
    schema: z.array(wireThreadSchema),
  })

export const createThread = (body: CreateThreadBody) =>
  cloudJson({
    method: EHttpMethod.Post,
    path: '/v1/threads',
    body,
    schema: createThreadReplySchema,
  })

export const fetchThread = (threadId: string) =>
  cloudJson({ method: EHttpMethod.Get, path: threadPath(threadId), schema: wireThreadSchema })

export const provisionSandbox = (args: { threadId: string }) =>
  cloudCall(api.threadSandbox.provision.mutate({ threadId: args.threadId }))

export const fetchPod = (threadId: string) => cloudCall(api.threadPod.status.query({ threadId }))

export const takeBackMessage = (args: { threadId: string; sendId: string }) =>
  cloudCall(api.threadMessages.takeBack.mutate(args))

export const postMessage = (args: { threadId: string; sendId: string; text: string }) =>
  cloudCall(api.threadMessages.send.mutate(args))

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

export const patchThreadModel = (args: {
  threadId: string
  model: { ref: string; effort: string }
}) =>
  cloudSend({
    method: EHttpMethod.Patch,
    path: `${threadPath(args.threadId)}/model`,
    body: args.model,
  })

export const setThreadArchived = (args: { threadId: string; archived: boolean }) =>
  cloudSend({
    method: EHttpMethod.Patch,
    path: `${threadPath(args.threadId)}/archived`,
    body: { archived: args.archived },
  })
