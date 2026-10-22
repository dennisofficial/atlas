#!/usr/bin/env -S node
import type {
  Contract as End,
  Contract as Start,
} from '../../snapshots/9f7bf2b0da764a13cf6bcb46cbb59a8905c8d7f20bdb54ef68455d72613703b0/contract';
import endContract from '../../snapshots/9f7bf2b0da764a13cf6bcb46cbb59a8905c8d7f20bdb54ef68455d72613703b0/contract.json' with { type: 'json' };
import startContract from '../../snapshots/9f7bf2b0da764a13cf6bcb46cbb59a8905c8d7f20bdb54ef68455d72613703b0/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import { backfillWorkspaceVercelProjectId } from './data-steps';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [backfillWorkspaceVercelProjectId];
  }
}

MigrationCLI.run(import.meta.url, M);
