// OpenRouter chat completion client. All calls stay on the server; the API key
// is decrypted just before use and never logged or returned to the browser.

export class OpenRouterError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = "OpenRouterError";
    this.status = status;
  }
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpenRouterCall {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  maxTokens?: number | null;
  temperature?: number | null;
  timeoutMs?: number;
}

export interface OpenRouterUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface OpenRouterCallResult {
  content: string;
  model: string; // model echoed by the provider when available
  usage: OpenRouterUsage | null;
  costCents: number | null; // estimated from usage + known rate; null = unknown
}

// USD per 1M tokens for common OpenRouter models. Matched by lowercase
// substring in declaration order (first match wins). Unknown models return a
// null cost rather than a fabricated estimate — budget enforcement then falls
// back to token totals only.
const MODEL_RATES: { match: string; input: number; output: number }[] = [
  { match: "gpt-4o-mini", input: 0.15, output: 0.6 },
  { match: "gpt-4o", input: 2.5, output: 10 },
  { match: "gpt-4.1-mini", input: 0.4, output: 1.6 },
  { match: "gpt-4.1", input: 2, output: 8 },
  { match: "claude-3-7-sonnet", input: 3, output: 15 },
  { match: "claude-3-5-sonnet", input: 3, output: 15 },
  { match: "claude-3-5-haiku", input: 0.8, output: 4 },
  { match: "claude-3-haiku", input: 0.25, output: 1.25 },
  { match: "gemini-2.5-pro", input: 1.25, output: 10 },
  { match: "gemini-2.5-flash", input: 0.3, output: 2.5 },
  { match: "gemini-2.0-flash", input: 0.1, output: 0.4 },
  { match: "llama-3.3-70b", input: 0.25, output: 0.25 },
  { match: "llama-3.1-70b", input: 0.25, output: 0.25 },
  { match: "llama-3.1-8b", input: 0.05, output: 0.05 },
  { match: "mistral-large", input: 2, output: 6 },
  { match: "mistral-medium", input: 0.6, output: 2.5 },
  { match: "mistral-small", input: 0.2, output: 0.6 },
  { match: "deepseek-reasoner", input: 0.55, output: 1.19 },
  { match: "deepseek-chat", input: 0.14, output: 0.28 },
];

export function estimateCostCents(model: string, usage: OpenRouterUsage | null): number | null {
  if (!usage) return null;
  const rate = MODEL_RATES.find((r) => model.toLowerCase().includes(r.match));
  if (!rate) return null;
  const usd = (usage.promptTokens / 1_000_000) * rate.input + (usage.completionTokens / 1_000_000) * rate.output;
  return Math.max(1, Math.round(usd * 100));
}

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export async function callOpenRouterDetailed(input: OpenRouterCall): Promise<OpenRouterCallResult> {
  if (!input.apiKey) throw new OpenRouterError("No OpenRouter API key configured for this site", 400);
  if (!input.model) throw new OpenRouterError("No model configured for this site", 400);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 120_000);

  const body: Record<string, unknown> = {
    model: input.model,
    messages: input.messages,
  };
  if (input.maxTokens) body.max_tokens = input.maxTokens;
  if (input.temperature !== null && input.temperature !== undefined) body.temperature = input.temperature;

  let res: Response;
  try {
    res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new OpenRouterError("OpenRouter request timed out", 504);
    }
    throw new OpenRouterError(`OpenRouter request failed: ${e instanceof Error ? e.message : "unknown error"}`, 502);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    let detail = "";
    try {
      const j = await res.json();
      detail = j?.error?.message ?? JSON.stringify(j);
    } catch {
      /* ignore */
    }
    // Never include the API key in error messages.
    throw new OpenRouterError(
      detail ? `OpenRouter error (${res.status}): ${detail}` : `OpenRouter error (HTTP ${res.status})`,
      res.status
    );
  }

  const data = (await res.json().catch(() => null)) as {
    choices?: { message?: { content?: string } }[];
    model?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  } | null;
  if (!data) throw new OpenRouterError("OpenRouter returned an unparseable response", 502);
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new OpenRouterError("OpenRouter returned an empty response", 502);

  const usage: OpenRouterUsage | null =
    typeof data.usage?.prompt_tokens === "number" || typeof data.usage?.completion_tokens === "number"
      ? {
          promptTokens: data.usage.prompt_tokens ?? 0,
          completionTokens: data.usage.completion_tokens ?? 0,
          totalTokens: data.usage.total_tokens ?? (data.usage.prompt_tokens ?? 0) + (data.usage.completion_tokens ?? 0),
        }
      : null;

  return {
    content: content.trim(),
    model: data.model ?? input.model,
    usage,
    costCents: estimateCostCents(data.model ?? input.model, usage),
  };
}

export async function callOpenRouter(input: OpenRouterCall): Promise<string> {
  return (await callOpenRouterDetailed(input)).content;
}