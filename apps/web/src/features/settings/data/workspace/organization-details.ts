import { z } from 'zod'

import { cloudJson, cloudSend, EHttpMethod } from '@/lib/cloud-api'

const AUTH = '/api/auth/organization'

const fullOrganizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  createdAt: z.string(),
  members: z.array(
    z.object({ role: z.string(), user: z.object({ name: z.string(), email: z.string() }) }),
  ),
})
export type OrganizationDetails = z.infer<typeof fullOrganizationSchema>

export const fetchOrganizationDetails = (organizationId: string): Promise<OrganizationDetails> =>
  cloudJson({
    method: EHttpMethod.Get,
    path: `${AUTH}/get-full-organization?organizationId=${encodeURIComponent(organizationId)}`,
    schema: fullOrganizationSchema,
  })

export const checkSlug = (slug: string) =>
  cloudSend({ method: EHttpMethod.Post, path: `${AUTH}/check-slug`, body: { slug } })

export const updateOrganization = (args: {
  organizationId: string
  data: { name?: string; slug?: string }
}) => cloudSend({ method: EHttpMethod.Post, path: `${AUTH}/update`, body: args })

export const deleteOrganization = (organizationId: string) =>
  cloudSend({ method: EHttpMethod.Post, path: `${AUTH}/delete`, body: { organizationId } })
