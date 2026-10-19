import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(16, "AUTH_SECRET must be at least 16 characters"),
  APP_ENC_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "APP_ENC_KEY must be 64 hex characters (32 bytes)"),
  SEED_ADMIN_EMAIL: z.string().email().optional(),
  SEED_ADMIN_PASSWORD: z.string().optional(),
  NEXT_PUBLIC_APP_URL: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
});

function loadEnv() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Invalid environment configuration: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`
    );
  }
  return parsed.data;
}

let cached: z.infer<typeof envSchema> | null = null;

export function env() {
  if (!cached) cached = loadEnv();
  return cached;
}

export function isTest() {
  return process.env.NODE_ENV === "test";
}
