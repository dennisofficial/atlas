import { rawSql } from '@prisma/orm-postgres/migration'

const label = 'Delete leftover v2 spike/test rows before adding NOT NULL session columns'

export const deleteLeftoverV2Rows = rawSql({
  id: 'data.delete-leftover-v2-rows',
  label,
  operationClass: 'data',
  target: {
    id: 'table.V2Session',
    details: { schema: 'v2', objectType: 'table' as const, name: 'V2Session' },
  },
  precheck: [],
  execute: [
    {
      description: label,
      sql: `DELETE FROM "v2"."V2Event";
DELETE FROM "v2"."V2InboxEntry";
DELETE FROM "v2"."V2Lease";
DELETE FROM "v2"."V2Thread";
DELETE FROM "v2"."V2Session"`,
    },
  ],
  postcheck: [],
})
