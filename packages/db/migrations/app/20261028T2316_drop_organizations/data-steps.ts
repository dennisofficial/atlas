import { rawSql } from '@prisma/orm-postgres/migration'

const label = 'Delete projects owned by an organization before every project requires a user owner'

export const deleteOrganizationProjects = rawSql({
  id: 'data.delete-organization-projects',
  label,
  operationClass: 'data',
  target: { id: 'table.Project', details: { schema: 'public', objectType: 'table' as const, name: 'Project' } },
  precheck: [],
  execute: [
    {
      description: label,
      sql: `DELETE FROM "public"."Project" WHERE "ownerUserId" IS NULL`,
    },
  ],
  postcheck: [],
})
