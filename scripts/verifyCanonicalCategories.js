'use strict';

const path = require('node:path');
const fs = require('node:fs');

function stripQuery(url) {
  const parsed = new URL(url);
  parsed.search = '';
  return parsed.toString();
}

async function main() {
  const sourceUrl = process.env.DATABASE_URL;
  if (!sourceUrl) throw new Error('DATABASE_URL tidak tersedia.');

  const source = new URL(stripQuery(sourceUrl));
  const testName = `work_category_reset_probe_${Date.now()}`;
  const adminUrl = new URL(source.toString());
  adminUrl.pathname = '/postgres';
  const testUrl = new URL(source.toString());
  testUrl.pathname = `/${testName}`;
  testUrl.searchParams.set('schema', 'public');

  const { execFileSync } = require('node:child_process');
  const psql = 'D:/as/postgres/bin/psql.exe';
  const pgDump = 'D:/as/postgres/bin/pg_dump.exe';
  const prisma = 'D:/maFile/file hermest/workspace/dives/newClone/be/node_modules/prisma/build/index.js';
  const migration = path.join(__dirname, '../prisma/migrations/20261009170000_reset_canonical_work_categories/migration.sql');
  const dump = path.join(process.env.TMPDIR || __dirname, `${testName}.sql`);

  const env = { ...process.env, DATABASE_URL: testUrl.toString() };
  try {
    execFileSync(psql, [adminUrl.toString(), '-v', 'ON_ERROR_STOP=1', '-c', `CREATE DATABASE "${testName}"`], { stdio: 'pipe' });
    execFileSync(pgDump, [stripQuery(sourceUrl), '--no-owner', '--no-privileges', '-f', dump], { stdio: 'pipe' });
    execFileSync(psql, [stripQuery(testUrl.toString()), '-v', 'ON_ERROR_STOP=1', '-f', dump], { stdio: 'pipe' });
    execFileSync(psql, [stripQuery(testUrl.toString()), '-v', 'ON_ERROR_STOP=1', '-f', migration], { stdio: 'pipe' });

    const output = execFileSync(psql, [stripQuery(testUrl.toString()), '-At', '-F', '|', '-c', `
      SELECT c."code", c."name", s."code", s."name", s."sortOrder"
      FROM "WorkCategory" c
      LEFT JOIN "WorkSubCategory" s ON s."categoryId" = c."id"
      ORDER BY c."sortOrder", s."sortOrder";
    `], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
    const expected = [
      'STRUKTUR|STRUKTUR|P.TN|PEK. Tanah|1',
      'STRUKTUR|STRUKTUR|P.BS|PEK. Baja Struktur|2',
      'STRUKTUR|STRUKTUR|P.BT|PEK. Beton|3',
      'ARSITEKTUR|ARSITEKTUR|DP|Dinding Partisi|1',
      'ARSITEKTUR|ARSITEKTUR|PA|Penutup Atap|2',
      'ARSITEKTUR|ARSITEKTUR|PDL|Penutup Dinding & Lantai|3',
      'ARSITEKTUR|ARSITEKTUR|CAT|Pengecatan|4',
      'ARSITEKTUR|ARSITEKTUR|PJ|Pintu & Jendela|5',
      'MEP|MEP|EL|Listrik|1',
      'MEP|MEP|FS|Fire Safety|2',
      'MEP|MEP|CCTV|CCTV|3',
      'MEP|MEP|PLB|Plumbing|4',
      'INTERIOR|INTERIOR|FUR|Furniture|1',
      'INTERIOR|INTERIOR|CRP|Carpet|2',
      'INTERIOR|INTERIOR|FLR|Flooring|3',
      'INTERIOR|INTERIOR|BW|BackWall|4',
    ];
    if (JSON.stringify(output) !== JSON.stringify(expected)) {
      throw new Error(`Canonical taxonomy mismatch:\n${output.join('\n')}`);
    }
    const categories = new Set(output.map((line) => line.split('|')[0]));
    if ([...categories].join(',') !== 'STRUKTUR,ARSITEKTUR,MEP,INTERIOR') {
      throw new Error(`Unexpected category order: ${[...categories].join(',')}`);
    }
    execFileSync(process.execPath, [prisma, 'validate'], { cwd: path.join(__dirname, '..'), env, stdio: 'pipe' });
    console.log(JSON.stringify({ testDatabase: testName, rows: output.length, categories: [...categories] }));
  } finally {
    try { execFileSync(psql, [adminUrl.toString(), '-c', `DROP DATABASE IF EXISTS "${testName}" WITH (FORCE)`], { stdio: 'pipe' }); } catch {}
    try { fs.unlinkSync(dump); } catch {}
  }
}

main().catch((error) => {
  console.error(error.stderr?.toString() || error.stack || error.message);
  process.exit(1);
});
