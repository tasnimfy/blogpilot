import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth";
import { AccessDeniedError } from "@/lib/access";
import { WebsiteServiceError } from "@/server/website.service";
import { SettingsServiceError } from "@/server/settings.service";
import { OpenRouterError } from "@/server/openrouter";
import { WordPressError } from "@/server/wordpress/client";
import { PublishServiceError } from "@/server/wordpress/publish.service";
import { ConnectionServiceError } from "@/server/wordpress/connection.service";
import { AccountServiceError } from "@/server/account.service";
import { DiscoveryServiceError } from "@/server/discovery.service";

export function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function apiError(error: unknown) {
  if (error instanceof AuthError) {
    return json({ error: "Not authenticated" }, { status: 401 });
  }
  if (error instanceof AccessDeniedError) {
    return json({ error: error.message }, { status: 403 });
  }
  if (
    error instanceof WebsiteServiceError ||
    error instanceof SettingsServiceError ||
    error instanceof PublishServiceError ||
    error instanceof ConnectionServiceError ||
    error instanceof AccountServiceError ||
    error instanceof DiscoveryServiceError
  ) {
    return json({ error: error.message }, { status: 400 });
  }
  if (error instanceof WordPressError) {
    return json({ error: error.message }, { status: error.status === 401 ? 401 : error.status >= 500 ? error.status : 502 });
  }
  if (error instanceof OpenRouterError) {
    return json({ error: error.message }, { status: error.status });
  }
  if (error instanceof SyntaxError) {
    return json({ error: "Malformed JSON body" }, { status: 400 });
  }
  console.error("Unhandled API error", error);
  return json({ error: "Internal server error" }, { status: 500 });
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new SyntaxError("Malformed JSON body");
  }
}
