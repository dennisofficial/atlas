import { rawSql } from '@prisma/orm-postgres/migration'

function tableTarget(table: string) {
  return {
    id: `table.${table}`,
    details: { schema: 'public', objectType: 'table' as const, name: table },
  }
}

function deleteEveryRow(table: string) {
  return rawSql({
    id: `data.preview-reset.${table}`,
    label: `Delete every ${table} row`,
    operationClass: 'data',
    target: tableTarget(table),
    precheck: [],
    execute: [{ description: `Delete every ${table} row`, sql: `DELETE FROM "public"."${table}"` }],
    postcheck: [],
  })
}

export const deletePreviewRows = [deleteEveryRow('PreviewRoute'), deleteEveryRow('PreviewTunnel')]
