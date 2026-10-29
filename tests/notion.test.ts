import { describe, expect, it } from "vitest";
import {
  buildBilingualBlocks,
  chatCompletionsUrl,
  chunkText,
  collectSegments,
  googleUrl,
  normalizeEndpoint,
  pageTitle,
  parseChatResponse,
  parseGoogleResponse,
  Block,
} from "../src/core.js";
import { extractTitle, NotionClient, translatePage } from "../src/notion.js";

const paragraph = (id: string, text: string): Block => ({
  object: "block",
  id,
  type: "paragraph",
  paragraph: { rich_text: [{ type: "text", text: { content: text } }] },
});

const heading = (id: string, text: string): Block => ({
  object: "block",
  id,
  type: "heading_1",
  heading_1: { rich_text: [{ type: "text", text: { content: text } }] },
});

describe("endpoint and payloads", () => {
  it("rejects schemeless endpoints and completes the chat path", () => {
    expect(() => normalizeEndpoint("api.openai.com")).toThrow(/must start with http/);
    expect(chatCompletionsUrl("https://api.openai.com/v1")).toBe("https://api.openai.com/v1/chat/completions");
  });

  it("parses provider answers and surfaces errors", () => {
    expect(parseChatResponse({ choices: [{ message: { content: "你好" } }] })).toBe("你好");
    expect(() => parseChatResponse({ error: { message: "bad key" } })).toThrow("bad key");
  });

  it("builds a Google URL with the target language", () => {
    const url = googleUrl("hello", "zh-CN");
    expect(url).toContain("tl=zh-CN");
    expect(url).toContain("q=hello");
  });
});

describe("segments", () => {
  it("collects only translatable blocks and skips empty ones", () => {
    const blocks = [heading("h1", "Title"), paragraph("p1", "   "), paragraph("p2", "Body")];
    expect(collectSegments(blocks).map((segment) => segment.blockId)).toEqual(["h1", "p2"]);
  });

  it("keeps the original above the translation", () => {
    const blocks = [paragraph("p1", "Hello")];
    const out = buildBilingualBlocks(blocks, new Map([["p1", "你好"]]));
    expect(out).toHaveLength(2);
    expect(JSON.stringify(out[0])).toContain("Hello");
    expect(JSON.stringify(out[1])).toContain("你好");
  });

  it("drops blocks without a translation instead of duplicating the source", () => {
    const out = buildBilingualBlocks([paragraph("p1", "Hello")], new Map());
    expect(out).toHaveLength(1);
  });

  it("chunks long text without losing characters", () => {
    const long = "x".repeat(250);
    expect(chunkText(long, 100)).toEqual(["x".repeat(100), "x".repeat(100), "x".repeat(50)]);
  });
});

describe("translatePage", () => {
  it("creates one bilingual page and translates every segment", async () => {
    const blocks = [heading("h1", "Intro"), paragraph("p1", "Hello world")];
    const calls: string[] = [];

    const fetcher = (async (input: any, init: any = {}) => {
      const url = String(input);
      calls.push(`${init.method ?? "GET"} ${url}`);
      if (url.includes("translate.googleapis.com")) {
        const query = new URL(url).searchParams.get("q")!;
        return new Response(JSON.stringify([[[`[${query}]`, query]], null, "en"]), { status: 200 });
      }
      if (url.endsWith("/pages/page-1")) {
        return new Response(
          JSON.stringify({
            id: "page-1",
            parent: { type: "page_id", page_id: "parent-1" },
            properties: { Name: { type: "title", title: [{ text: { content: "My Paper" } }] } },
          }),
          { status: 200 }
        );
      }
      if (url.includes("/blocks/page-1/children")) {
        return new Response(JSON.stringify({ results: blocks, has_more: false }), { status: 200 });
      }
      if (url.endsWith("/pages") && init.method === "POST") {
        return new Response(JSON.stringify({ id: "new-page" }), { status: 200 });
      }
      if (url.includes("/blocks/new-page/children")) {
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      }
      return new Response("unexpected " + url, { status: 500 });
    }) as unknown as typeof fetch;

    const client = new NotionClient("token", fetcher);
    const result = await translatePage(client, "page-1", { engine: "google", target: "zh-CN" }, fetcher);

    expect(result.pageId).toBe("new-page");
    expect(result.blocks).toBe(4); // heading + translation, paragraph + translation
    expect(calls.filter((call) => call.includes("translate.googleapis.com")).length).toBe(2);
  });
});

describe("page helpers", () => {
  it("reads the title property and labels the copy", () => {
    expect(extractTitle({ properties: { Name: { type: "title", title: [{ text: { content: "Paper" } }] } } })).toBe("Paper");
    expect(pageTitle("Paper", "zh-CN")).toBe("Paper · zh-CN");
  });
});
