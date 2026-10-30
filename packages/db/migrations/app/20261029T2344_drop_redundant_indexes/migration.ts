#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/a7d41c08974879da5ec02d956fc526de4d5f955818d32119a17019e198d0a159/contract';
import startContract from '../../snapshots/a7d41c08974879da5ec02d956fc526de4d5f955818d32119a17019e198d0a159/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/a81a3193f0178f2224163adb9fff0d54f35cc4c56dfe45ff7afe1c194562efd7/contract';
import endContract from '../../snapshots/a81a3193f0178f2224163adb9fff0d54f35cc4c56dfe45ff7afe1c194562efd7/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropIndex({ schema: 'public', table: 'Event', index: 'Event_userId_idx' }),
      this.dropIndex({
        schema: 'public',
        table: 'GithubPrEventDelivery',
        index: 'GithubPrEventDelivery_eventId_idx_6a266d47',
      }),
      this.dropIndex({ schema: 'public', table: 'Session', index: 'Session_userId_idx_a489d58a' }),
      this.dropIndex({
        schema: 'public',
        table: 'ThreadRead',
        index: 'ThreadRead_userId_idx_a489d58a',
      }),
      this.createIndex({
        schema: 'public',
        table: 'Event',
        index: 'Event_userId_type_at_idx',
        columns: ['userId', 'type', 'at'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
