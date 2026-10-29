#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/7e0c420de4f0a5096eabb3d87bb07f1563da8304e1ea5976887359ebacb62e49/contract';
import startContract from '../../snapshots/7e0c420de4f0a5096eabb3d87bb07f1563da8304e1ea5976887359ebacb62e49/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/b4d2e89e8a65765912a017f22242339633a03efa5531d3746c5d99550a240aab/contract';
import endContract from '../../snapshots/b4d2e89e8a65765912a017f22242339633a03efa5531d3746c5d99550a240aab/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import { deleteLocalPodThreads } from './data-steps';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [deleteLocalPodThreads, this.dropTable({ schema: 'public', table: 'LocalPodCheckpoint' })];
  }
}

MigrationCLI.run(import.meta.url, M);
