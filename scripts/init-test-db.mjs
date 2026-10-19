// Recreates the test database from the schema (used by CI / local test setup).
// Usage: node scripts/init-test-db.mjs
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

execSync("npx prisma db push --force-reset --skip-generate", {
  cwd: root,
  env: { ...process.env, DATABASE_URL: "file:./test.db" },
  stdio: "inherit",
});
console.log("Test database initialised at prisma/test.db");
