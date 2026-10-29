/**
 * Thin Notion API client plus the translation driver.
 *
 * Kept deliberately small: four endpoints are enough to mirror a page, and every call takes an
 * injected `fetch` so the tests can run offline.
 */

import {
  Block,
  buildBilingualBlocks,
  buildChatPayload,
  chatCompletionsUrl,
  chunkText,
  collectSegments,
  googleUrl,
  pageTitle,
  parseChatResponse,
  parseGoogleResponse,
} from "./core.js";

export type TranslateSettings = {
  engine: "google" | "ai";
  target: string;
  endpoint?: string;
  apiKey?: string;
  model?: string;
};

export type Fetcher = typeof fetch;

const NOTION_VERSION = "2022-06-28";
const NOTION_BASE = "https://api.notion.com/v1";

export class NotionClient {
  constructor(
    private readonly token: string,
    private readonly fetcher: Fetcher = fetch
  ) {}

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetcher(`${NOTION_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Notion ${response.status}: ${body.slice(0, 300)}`);
    }
    return (await response.json()) as T;
  }

  async retrievePage(pageId: string): Promise<any> {
    return this.call(`/pages/${pageId}`);
  }

  /** Blocks are paginated; a page can easily need more than one request. */
  async listChildren(blockId: string): Promise<Block[]> {
    const blocks: Block[] = [];
    let cursor: string | undefined;
    do {
      const query = cursor ? `?page_size=100&start_cursor=${encodeURIComponent(cursor)}` : "?page_size=100";
      const page = await this.call<any>(`/blocks/${blockId}/children${query}`);
      blocks.push(...(page.results as Block[]));
      cursor = page.has_more ? page.next_cursor : undefined;
    } while (cursor);
    return blocks;
  }

  async createPage(parent: { page_id: string } | { database_id: string }, title: string): Promise<any> {
    return this.call("/pages", {
      method: "POST",
      body: JSON.stringify({
        parent,
        properties: {
          title: { title: [{ type: "text", text: { content: title } }] },
        },
      }),
    });
  }

  async appendChildren(blockId: string, children: Record<string, unknown>[]): Promise<void> {
    for (let index = 0; index < children.length; index += 100) {
      const batch = children.slice(index, index + 100);
      await this.call(`/blocks/${blockId}/children`, {
        method: "PATCH",
        body: JSON.stringify({ children: batch }),
      });
    }
  }
}

export async function translateText(
  text: string,
  settings: TranslateSettings,
  fetcher: Fetcher = fetch
): Promise<string> {
  const chunks = chunkText(text);
  const pieces: string[] = [];

  for (const chunk of chunks) {
    if (settings.engine === "google") {
      const response = await fetcher(googleUrl(chunk, settings.target));
      if (!response.ok) throw new Error(`Google Translate HTTP ${response.status}`);
      pieces.push(parseGoogleResponse(await response.json()));
      continue;
    }

    const url = chatCompletionsUrl(settings.endpoint ?? "https://api.openai.com/v1");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
    const response = await fetcher(url, {
      method: "POST",
      headers,
      body: JSON.stringify(buildChatPayload(settings.model ?? "gpt-4o-mini", chunk, settings.target)),
    });
    if (!response.ok) {
      throw new Error(`The provider returned HTTP ${response.status}: ${(await response.text()).slice(0, 160)}`);
    }
    pieces.push(parseChatResponse(await response.json()));
  }

  return pieces.join("\n\n");
}

/**
 * Mirror a page into a new bilingual page under the same parent.
 * Returns the id of the page that was created.
 */
export async function translatePage(
  client: NotionClient,
  pageId: string,
  settings: TranslateSettings,
  fetcher: Fetcher = fetch
): Promise<{ pageId: string; blocks: number }> {
  const page = await client.retrievePage(pageId);
  const blocks = await client.listChildren(pageId);
  const segments = collectSegments(blocks);

  const translations = new Map<string, string>();
  for (const segment of segments) {
    translations.set(segment.blockId, await translateText(segment.text, settings, fetcher));
  }

  const title = extractTitle(page) || "Untitled";
  const parent = page.parent?.type === "database_id" ? { database_id: page.parent.database_id } : { page_id: page.parent.page_id };
  const created = await client.createPage(parent as any, pageTitle(title, settings.target));

  const children = buildBilingualBlocks(blocks, translations);
  if (children.length) await client.appendChildren(created.id, children);

  return { pageId: created.id, blocks: children.length };
}

export function extractTitle(page: any): string {
  const titleProperty = Object.values(page?.properties ?? {}).find(
    (property: any) => property?.type === "title"
  ) as any;
  const parts = titleProperty?.title ?? [];
  return parts.map((part: any) => part?.text?.content ?? part?.plain_text ?? "").join("").trim();
}
