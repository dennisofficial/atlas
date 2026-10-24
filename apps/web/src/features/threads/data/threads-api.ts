import { createThreadReplySchema, projectSchema } from '@dltech/atlas-wire/web'
import { z } from 'zod'

import { api, cloudCall } from '@/lib/api-client'
import { cloudJson, EHttpMethod } from '@/lib/cloud-api'

import type { CreateThreadBody } from './create-thread'

export const fetchProjects = () =>
  cloudJson({ method: EHttpMethod.Get, path: '/v1/projects', schema: z.array(projectSchema) })

export const fetchThreads = (projectId: string) => cloudCall(api.threads.list.query({ projectId }))

export const createThread = async (body: CreateThreadBody) =>
  createThreadReplySchema.parse(await cloudCall(api.threads.create.mutate(body)))

export const fetchThread = (threadId: string) => cloudCall(api.threads.get.query({ threadId }))

export const provisionSandbox = (args: { threadId: string }) =>
  cloudCall(api.threadSandbox.provision.mutate({ threadId: args.threadId }))

export const fetchPod = (threadId: string) => cloudCall(api.threadPod.status.query({ threadId }))

export const takeBackMessage = (args: { threadId: string; sendId: string }) =>
  cloudCall(api.threadMessages.takeBack.mutate(args))

export const postMessage = (args: { threadId: string; sendId: string; text: string }) =>
  cloudCall(api.threadMessages.send.mutate(args))

export const fetchHead = (threadId: string) => cloudCall(api.threadEvents.head.query({ threadId }))

export const fetchEvents = (threadId: string) =>
  cloudCall(api.threadEvents.read.query({ threadId, own: true }))

export const patchThreadModel = (args: {
  threadId: string
  model: { ref: string; effort: string }
}) => cloudCall(api.threads.chooseModel.mutate({ threadId: args.threadId, ...args.model }))

export const setThreadArchived = (args: { threadId: string; archived: boolean }) =>
  cloudCall(api.threads.archive.mutate(args))
