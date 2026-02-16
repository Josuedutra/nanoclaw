/**
 * Prune old backups — keep the most recent N backups, delete the rest.
 * Usage: node scripts/prune-backups.ts [--keep N]
 * Default: keep 7 backups.
 */
import fs from 'fs';
import path from 'path';

const BACKUP_DIR = path.resolve(process.cwd(), 'backups');
const DEFAULT_KEEP = 7;

function main(): void {
  const keepArg = process.argv.indexOf('--keep');
  const keep = keepArg >= 0 ? parseInt(process.argv[keepArg + 1], 10) || DEFAULT_KEEP : DEFAULT_KEEP;

  if (!fs.existsSync(BACKUP_DIR)) {
    console.log('No backups directory found.');
    return;
  }

  const files = fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith('os-backup-') && f.endsWith('.tar.gz'))
    .sort()
    .reverse(); // newest first

  if (files.length <= keep) {
    console.log(`${files.length} backups found, keeping all (limit: ${keep}).`);
    return;
  }

  const toDelete = files.slice(keep);
  for (const f of toDelete) {
    const archivePath = path.join(BACKUP_DIR, f);
    const hashPath = `${archivePath}.sha256`;
    fs.unlinkSync(archivePath);
    if (fs.existsSync(hashPath)) fs.unlinkSync(hashPath);
    console.log(`Deleted: ${f}`);
  }

  console.log(`Pruned ${toDelete.length} old backup(s), kept ${keep}.`);
}

main();
