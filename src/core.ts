/**
 * DualTran for Notion — translation core.
 *
 * Everything here is pure: no network, no Notion client. The integration layer (`notion.ts`)
 * feeds these functions and writes the result back, which keeps the interesting logic testable.
 */

export type RichText = { type: "text"; text: { content: string } };

export type Block = {
  object: "block";
  id: string;
  type: string;
  has_children?: boolean;
  [key: string]: unknown;
};

export type Segment = { blockId: string; path: ("content" | "caption")[]; text: string };

export const TRANSLATABLE = new Set([
  "paragraph",
  "heading_1",
  "heading_2",
  "heading_3",
  "bulleted_list_item",
  "numbered_list_item",
  "quote",
  "callout",
  "toggle",
  "code",
]);

const MAX_QUERY = 1800;

export function normalizeEndpoint(endpoint: string): string {
  const trimmed = String(endpoint || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error(`Endpoint must start with http:// or https:// (got "${endpoint}")`);
  }
  return trimmed;
}

export function chatCompletionsUrl(endpoint: string): string {
  const base = normalizeEndpoint(endpoint);
  if (/\/chat\/completions$/i.test(base)) return base;
  if (/\/v\d+$/i.test(base)) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

export function buildChatPayload(model: string, text: string, target: string): Record<string, unknown> {
  return {
    model,
    temperature: 0,
    stream: false,
    messages: [
      {
        role: "system",
        content:
          `You translate into ${target}. Return only the translation, no commentary and no quotes. ` +
          "Keep names, numbers, inline code and links exactly as they appear. " +
          `If the text is already in ${target}, return it unchanged.`,
      },
      { role: "user", content: text },
    ],
  };
}

export function parseChatResponse(payload: any): string {
  if (payload?.error?.message) throw new Error(payload.error.message);
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("The provider returned an empty translation");
  }
  return content.trim();
}

export function googleUrl(text: string, target: string, source = "auto"): string {
  const params = new URLSearchParams({ client: "gtx", sl: source, tl: target, dt: "t", q: text });
  return `https://translate.googleapis.com/translate_a/single?${params.toString()}`;
}

export function parseGoogleResponse(payload: any): string {
  const rows = payload?.[0];
  if (!Array.isArray(rows)) throw new Error("Unexpected response from Google Translate");
  const text = rows.map((row: any) => (Array.isArray(row) && row[0] ? String(row[0]) : "")).join("").trim();
  if (!text) throw new Error("Google Translate returned an empty translation");
  return text;
}

export function chunkText(text: string, limit = MAX_QUERY): string[] {
  const clean = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  if (clean.length <= limit) return [clean];

  const parts: string[] = [];
  let current = "";
  for (const paragraph of clean.split(/\n{2,}/)) {
    if ((`${current}\n\n${paragraph}`).trim().length <= limit) {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
      continue;
    }
    if (current) parts.push(current);
    if (paragraph.length <= limit) {
      current = paragraph;
      continue;
    }
    for (let index = 0; index < paragraph.length; index += limit) {
      parts.push(paragraph.slice(index, index + limit));
    }
    current = "";
  }
  if (current) parts.push(current);
  return parts;
}

/** Pull the translatable text out of a flat block list, keeping enough context to write it back. */
export function collectSegments(blocks: Block[]): Segment[] {
  const segments: Segment[] = [];
  for (const block of blocks) {
    if (!TRANSLATABLE.has(block.type)) continue;
    const body = block[block.type] as { rich_text?: RichText[]; caption?: RichText[] } | undefined;
    const richText = body?.rich_text ?? [];
    const text = richText.map((part) => part?.text?.content ?? "").join("");
    if (text.trim()) segments.push({ blockId: block.id, path: ["content"], text });
    const caption = body?.caption;
    if (Array.isArray(caption)) {
      const captionText = caption.map((part) => part?.text?.content ?? "").join("");
      if (captionText.trim()) segments.push({ blockId: block.id, path: ["caption"], text: captionText });
    }
  }
  return segments;
}

/**
 * Build the block payload for a mirrored page: every source block, then its translation directly
 * underneath, so a reader can compare line by line.
 */
export function buildBilingualBlocks(blocks: Block[], translations: Map<string, string>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const block of blocks) {
    if (!TRANSLATABLE.has(block.type)) continue;
    const body = block[block.type] as { rich_text?: RichText[]; caption?: RichText[] } | undefined;
    const richText = body?.rich_text ?? [];
    const text = richText.map((part) => part?.text?.content ?? "").join("");
    if (!text.trim()) continue;

    out.push(blockPayload(block.type, richText, body?.caption));
    const translated = translations.get(block.id);
    if (translated) {
      out.push(blockPayload(block.type, [{ type: "text", text: { content: translated } }]));
    }
  }
  return out;
}

export function blockPayload(
  type: string,
  richText: RichText[],
  caption?: RichText[]
): Record<string, unknown> {
  if (type === "code") {
    return {
      object: "block",
      type,
      code: { rich_text: richText, language: "plain text" },
    };
  }
  const value: Record<string, unknown> = { rich_text: richText };
  if (Array.isArray(caption) && caption.length) value.caption = caption;
  return { object: "block", type, [type]: value };
}

export function pageTitle(title: string, target: string): string {
  return `${title} · ${target}`;
}
