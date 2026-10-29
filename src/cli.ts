#!/usr/bin/env node
/**
 * npx dualtran-notion translate <pageId>
 *
 * Environment: NOTION_TOKEN, plus DUALTRAN_ENGINE (google|ai), DUALTRAN_TARGET,
 * DUALTRAN_ENDPOINT, DUALTRAN_API_KEY, DUALTRAN_MODEL.
 */

import { NotionClient, translatePage } from "./notion.js";

async function main(): Promise<void> {
  const [command, pageId] = process.argv.slice(2);
  if (command !== "translate" || !pageId) {
    console.error("usage: dualtran-notion translate <pageId>");
    process.exit(2);
  }

  const token = process.env.NOTION_TOKEN;
  if (!token) {
    console.error("NOTION_TOKEN is not set");
    process.exit(2);
  }

  const settings = {
    engine: (process.env.DUALTRAN_ENGINE === "ai" ? "ai" : "google") as "google" | "ai",
    target: process.env.DUALTRAN_TARGET || "zh-CN",
    endpoint: process.env.DUALTRAN_ENDPOINT,
    apiKey: process.env.DUALTRAN_API_KEY,
    model: process.env.DUALTRAN_MODEL,
  };

  const client = new NotionClient(token);
  const result = await translatePage(client, pageId, settings);
  console.log(`created page ${result.pageId} with ${result.blocks} blocks`);
}

main().catch((error) => {
  console.error(String(error?.message ?? error));
  process.exit(1);
});
