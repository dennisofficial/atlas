#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/3a633b04798a32f8f70949fd0f91021d862a3b94fd983ac5209ac650b3c96178/contract';
import startContract from '../../snapshots/3a633b04798a32f8f70949fd0f91021d862a3b94fd983ac5209ac650b3c96178/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/4dd6b4ae96e6bac6c84a30e83894c3ac0c8f3e48c43a22bcbc5841ee7ce35210/contract';
import endContract from '../../snapshots/4dd6b4ae96e6bac6c84a30e83894c3ac0c8f3e48c43a22bcbc5841ee7ce35210/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import { deleteOrganizationProjects } from './data-steps';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      deleteOrganizationProjects,
      this.dropTable({ schema: 'public', table: 'Invitation' }),
      this.dropTable({ schema: 'public', table: 'Member' }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'Project',
        constraint: 'Project_exactly_one_owner_ad5ba0b8',
      }),
      this.dropConstraint({
        schema: 'public',
        table: 'Project',
        constraint: 'Project_organizationId_fkey',
        kind: 'foreignKey',
      }),
      this.dropIndex({ schema: 'public', table: 'Project', index: 'Project_organizationId_idx' }),
      this.dropColumn({ schema: 'public', table: 'Project', column: 'organizationId' }),
      this.dropColumn({ schema: 'public', table: 'Session', column: 'activeOrganizationId' }),
      this.dropConstraint({
        schema: 'public',
        table: 'Thread',
        constraint: 'Thread_organizationId_fkey',
        kind: 'foreignKey',
      }),
      this.dropIndex({ schema: 'public', table: 'Thread', index: 'Thread_organizationId_idx' }),
      this.dropColumn({ schema: 'public', table: 'Thread', column: 'organizationId' }),
      this.dropTable({ schema: 'public', table: 'WorkspaceMcpServer' }),
      this.dropTable({ schema: 'public', table: 'WorkspaceSecret' }),
      this.dropTable({ schema: 'public', table: 'WorkspaceSetting' }),
      this.dropTable({ schema: 'public', table: 'WorkspaceVercelCredential' }),
      this.dropTable({ schema: 'public', table: 'Organization' }),
      this.setNotNull({ schema: 'public', table: 'Project', column: 'ownerUserId' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
