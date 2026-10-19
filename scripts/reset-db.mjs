// Force-resets the development database and reseeds the admin account.
// Usage: node scripts/reset-db.mjs
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

execSync("npx prisma migrate reset --force --skip-seed", { cwd: root, stdio: "inherit" });
execSync("node scripts/seed-admin.mjs", { cwd: root, stdio: "inherit" });
console.log("Database reset complete.");
