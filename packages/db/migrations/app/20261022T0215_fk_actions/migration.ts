#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/4b21b92c0047588b00bd27a37dd0bef377d3846e2da0d39381d0f597e551d345/contract'
import startContract from '../../snapshots/4b21b92c0047588b00bd27a37dd0bef377d3846e2da0d39381d0f597e551d345/contract.json' with {
  type: 'json',
}
import type { Contract as End } from '../../snapshots/64cb0885c524619aabe36260368c3940d543a21b3ee63b53c73aea62f33a6d4b/contract'
import endContract from '../../snapshots/64cb0885c524619aabe36260368c3940d543a21b3ee63b53c73aea62f33a6d4b/contract.json' with {
  type: 'json',
}
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration'

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract
  override readonly endContractJson = endContract

  override get operations() {
    return [
      this.dropConstraint({
        schema: 'public',
        table: 'Project',
        constraint: 'Project_organizationId_fkey',
        kind: 'foreignKey',
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'Project',
        foreignKey: {
          name: 'Project_organizationId_fkey',
          columns: ['organizationId'],
          references: { schema: 'public', table: 'Organization', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.dropConstraint({
        schema: 'public',
        table: 'Thread',
        constraint: 'Thread_parentThreadId_fkey',
        kind: 'foreignKey',
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'Thread',
        foreignKey: {
          name: 'Thread_parentThreadId_fkey',
          columns: ['parentThreadId'],
          references: { schema: 'public', table: 'Thread', columns: ['id'] },
          onDelete: 'setNull',
          onUpdate: 'noAction',
        },
      }),
      this.dropConstraint({
        schema: 'public',
        table: 'Thread',
        constraint: 'Thread_spawnerThreadId_fkey',
        kind: 'foreignKey',
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'Thread',
        foreignKey: {
          name: 'Thread_spawnerThreadId_fkey',
          columns: ['spawnerThreadId'],
          references: { schema: 'public', table: 'Thread', columns: ['id'] },
          onDelete: 'setNull',
          onUpdate: 'noAction',
        },
      }),
    ]
  }
}

MigrationCLI.run(import.meta.url, M)
