#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/48eae429cd208fd07b61e49b7abc76598096c07ec0528c1142d8fec838d5a974/contract';
import endContract from '../../snapshots/48eae429cd208fd07b61e49b7abc76598096c07ec0528c1142d8fec838d5a974/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/cc41152adc40314d3a65a4dcfa9f1377281450f71fae9b89d6dc22eb6b0cec30/contract';
import startContract from '../../snapshots/cc41152adc40314d3a65a4dcfa9f1377281450f71fae9b89d6dc22eb6b0cec30/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import { archiveOperations } from './archive-steps';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return archiveOperations();
  }
}

MigrationCLI.run(import.meta.url, M);
