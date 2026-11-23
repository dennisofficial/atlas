import { api, cloudCall } from '@/lib/api-client'

export const fetchSessionCommands = async () =>
  (await cloudCall(api.sessions.commands.query({}))).commands
