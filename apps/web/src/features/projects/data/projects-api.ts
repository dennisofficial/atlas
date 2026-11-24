import { api, cloudCall } from '@/lib/api-client'

export const fetchProjects = () => cloudCall(api.projects.list.query())
