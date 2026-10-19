import { describe, it, expect, afterEach } from "vitest";
import { callOpenRouter, OpenRouterError } from "@/server/openrouter";

function stubFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  globalThis.fetch = impl as unknown as typeof fetch;
}
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("OpenRouter client", () => {
  it("returns the assistant content on success", async () => {
    stubFetch(async () => new Response(JSON.stringify({ choices: [{ message: { content: "Hello" } }] })));
    const out = await callOpenRouter({ apiKey: "sk-abc", model: "m", messages: [{ role: "user", content: "hi" }] });
    expect(out).toBe("Hello");
  });

  it("throws a clean 401 without leaking the key on auth failure", async () => {
    stubFetch(async () =>
      new Response(JSON.stringify({ error: { message: "invalid api key" } }), { status: 401 })
    );
    await expect(callOpenRouter({ apiKey: "sk-SUPERSECRET", model: "m", messages: [] })).rejects.toMatchObject({
      name: "OpenRouterError",
      status: 401,
    });
  });

  it("handles a non-JSON response as a 502 error", async () => {
    stubFetch(async () => new Response("<html>proxy error</html>", { status: 200 }));
    await expect(callOpenRouter({ apiKey: "sk-abc", model: "m", messages: [] })).rejects.toMatchObject({
      name: "OpenRouterError",
      status: 502,
    });
  });

  it("returns an empty-response error", async () => {
    stubFetch(async () => new Response(JSON.stringify({ choices: [] })));
    await expect(callOpenRouter({ apiKey: "sk-abc", model: "m", messages: [] })).rejects.toThrow(OpenRouterError);
  });

  it("requires a key and a model", async () => {
    await expect(callOpenRouter({ apiKey: "", model: "m", messages: [] })).rejects.toMatchObject({ status: 400 });
    await expect(callOpenRouter({ apiKey: "sk-abc", model: "", messages: [] })).rejects.toMatchObject({ status: 400 });
  });
});
