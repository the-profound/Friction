import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const root = path.resolve(__dirname, "..", "..", "..");

const GENERATED_DIRS = [
  path.resolve(root, "lib", "api-client-react", "src", "generated"),
  path.resolve(root, "lib", "api-zod", "src", "generated"),
];

const BACKUP_SUFFIX = "__safe_codegen_backup__";

function backup(dir) {
  const backupDir = dir + BACKUP_SUFFIX;
  if (fs.existsSync(backupDir)) {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
  if (fs.existsSync(dir)) {
    fs.cpSync(dir, backupDir, { recursive: true });
  }
}

function restore(dir) {
  const backupDir = dir + BACKUP_SUFFIX;
  if (fs.existsSync(backupDir)) {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    fs.renameSync(backupDir, dir);
  }
}

function dropBackup(dir) {
  const backupDir = dir + BACKUP_SUFFIX;
  if (fs.existsSync(backupDir)) {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
}

function dropGenerated(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

for (const dir of GENERATED_DIRS) {
  backup(dir);
  dropGenerated(dir);
}

try {
  execSync("orval --config ./orval.config.ts", {
    stdio: "inherit",
    cwd: path.resolve(__dirname, ".."),
  });

  for (const dir of GENERATED_DIRS) {
    dropBackup(dir);
  }

  console.log("\n✓ Codegen succeeded. Generated files updated.");
} catch (err) {
  console.error("\n✗ Codegen failed. Restoring previous generated files...");

  for (const dir of GENERATED_DIRS) {
    dropGenerated(dir);
    restore(dir);
  }

  process.exit(1);
}
