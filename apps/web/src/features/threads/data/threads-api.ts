import { z } from 'zod'

import {
  createThreadReplySchema,
  podStatusSchema,
  sandboxProvisionPath,
  sandboxProvisionReplySchema,
  threadMessagePath,
  threadMessageReplySchema,
  threadMessageTakeBackPath,
  threadPodPath,
  wireEventSchema,
  wireThreadSchema,
} from '@dltech/atlas-wire/web'
import { projectSchema } from '@dltech/atlas-wire/web'

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
  cloudJson({
    method: EHttpMethod.Post,
    path: sandboxProvisionPath(args.threadId),
    body: {},
    schema: sandboxProvisionReplySchema,
  })

export const fetchPod = (threadId: string) =>
  cloudJson({ method: EHttpMethod.Get, path: threadPodPath(threadId), schema: podStatusSchema })

export const takeBackMessage = (args: { threadId: string; sendId: string }) =>
  cloudSend({ method: EHttpMethod.Delete, path: threadMessageTakeBackPath(args) })

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

export const patchThreadModel = (args: {
  threadId: string
  model: { ref: string; effort: string }
}) =>
  cloudSend({
    method: EHttpMethod.Patch,
    path: `${threadPath(args.threadId)}/model`,
    body: args.model,
  })
