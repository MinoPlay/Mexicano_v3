import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export function verifyBackup(rootDir) {
  const manifestPath = path.join(rootDir, 'supabase-backup', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  for (const file of manifest.files || []) {
    const target = path.join(rootDir, file.path);
    if (!fs.existsSync(target)) throw new Error(`Backup file is missing: ${file.path}`);
    const content = fs.readFileSync(target);
    if (sha256(content) !== file.sha256) throw new Error(`Backup checksum mismatch: ${file.path}`);
  }
  for (const [table, expectedCount] of Object.entries(manifest.record_counts || {})) {
    const rows = JSON.parse(fs.readFileSync(
      path.join(rootDir, 'supabase-backup', 'tables', `${table}.json`),
      'utf8',
    ));
    if (!Array.isArray(rows) || rows.length !== expectedCount) {
      throw new Error(`Backup row count mismatch for ${table}: expected ${expectedCount}`);
    }
  }
  return {
    filesVerified: manifest.files.length,
    recordCounts: manifest.record_counts,
  };
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  const rootDir = process.env.DATAHUB_ROOT || process.argv[2];
  if (!rootDir) {
    console.error('DATAHUB_ROOT or a backup root argument is required.');
    process.exit(1);
  }
  try {
    console.log(JSON.stringify(verifyBackup(rootDir), null, 2));
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
}
