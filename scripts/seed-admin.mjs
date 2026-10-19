// Creates or updates the initial operator account from .env seed values.
// Usage: node scripts/seed-admin.mjs
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { loadEnvFile } from "node:process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, "../.env");
if (existsSync(envPath)) {
  loadEnvFile(envPath);
}

const email = process.env.SEED_ADMIN_EMAIL;
const password = process.env.SEED_ADMIN_PASSWORD;
if (!email || !password) {
  console.error("SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set in .env");
  process.exit(1);
}

const prisma = new PrismaClient();
const hash = bcrypt.hashSync(password, 12);
const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
if (existing) {
  await prisma.user.update({
    where: { id: existing.id },
    data: { passwordHash: hash, globalRole: "OPERATOR", isActive: true },
  });
  console.log(`Updated admin account ${email}`);
} else {
  await prisma.user.create({
    data: { email: email.toLowerCase(), passwordHash: hash, globalRole: "OPERATOR", isActive: true },
  });
  console.log(`Created admin account ${email}`);
}
await prisma.$disconnect();
