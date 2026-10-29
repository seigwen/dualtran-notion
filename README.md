# DualTran for Notion

Mirror a Notion page into a **bilingual copy**: every paragraph appears with its translation
directly underneath, so readers can compare line by line. The original page is never touched.

Notion has no in-page extension API, so this is an integration that talks to the Notion API and
does the work server-side (or on your laptop).

## Use

```bash
export NOTION_TOKEN=secret_…            # internal integration, shared with the page
export DUALTRAN_TARGET=zh-CN
npx dualtran-notion translate <pageId>
```

Engine: Google Translate by default. For AI:

```bash
export DUALTRAN_ENGINE=ai DUALTRAN_ENDPOINT=https://api.openai.com/v1 \
       DUALTRAN_API_KEY=sk-… DUALTRAN_MODEL=gpt-4o-mini
```

The integration needs **Read content** and **Insert content** capabilities, and the page must be
shared with it (Notion → page → ⋯ → Connections).

## How it works

1. `retrievePage` + paginated `listChildren` — the page's own title and its top-level blocks.
2. Every translatable block (paragraphs, headings, lists, quotes, callouts, toggles, code) is
   translated in order, in one request each.
3. A new page is created under the same parent, titled `<title> · <target>`, and filled with
   *source block, then its translation*, batched 100 blocks per request.

## Status

- 9 unit tests, including an end-to-end `translatePage` run against a fake Notion + a fake
  translator (`npm test`), `tsc --noEmit` clean.
- **Not yet run against a live Notion workspace** — that needs an integration token and a shared
  page. Nested blocks (children of toggles/columns) are not mirrored yet.

## Licence

MPL-2.0.
