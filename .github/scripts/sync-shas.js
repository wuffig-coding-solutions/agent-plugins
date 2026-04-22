#!/usr/bin/env bun
/**
 * Syncs the `sha` field for git-subdir plugins in marketplace.json.
 *
 * - If UPDATED_PLUGIN + UPDATED_SHA are set (from repository_dispatch):
 *   updates only that plugin's sha using the value from the payload.
 * - Otherwise (manual workflow_dispatch):
 *   fetches the latest sha for every git-subdir plugin via GitHub API.
 */

import { readFileSync, writeFileSync } from "fs";

const MARKETPLACE_PATH = ".claude-plugin/marketplace.json";
const marketplace = JSON.parse(readFileSync(MARKETPLACE_PATH, "utf8"));

const updatedPlugin = process.env.UPDATED_PLUGIN;
const updatedSha = process.env.UPDATED_SHA;
const ghToken = process.env.GH_TOKEN;

function repoSlug(url) {
  const match = url.match(/github\.com\/([^/]+\/[^/.]+?)(?:\.git)?$/);
  return match ? match[1] : url;
}

async function getLatestSha(url, ref = "main") {
  const repo = repoSlug(url);
  const res = await fetch(
    `https://api.github.com/repos/${repo}/commits/${ref}`,
    {
      headers: {
        Authorization: `Bearer ${ghToken}`,
        "User-Agent": "claude-plugins-registry",
        Accept: "application/vnd.github+json",
      },
    },
  );
  if (!res.ok)
    throw new Error(
      `GitHub API error for ${repo}: ${res.status} ${res.statusText}`,
    );
  const data = await res.json();
  return data.sha;
}

for (const plugin of marketplace.plugins) {
  if (plugin.source?.source !== "git-subdir") continue;

  // On dispatch: only update the plugin that triggered the event
  if (updatedPlugin && plugin.name !== updatedPlugin) continue;

  if (updatedPlugin && updatedSha) {
    plugin.source.sha = updatedSha;
    console.log(`${plugin.name}: updated sha → ${updatedSha.slice(0, 7)}`);
  } else {
    // Manual run: fetch latest sha from GitHub API
    const sha = await getLatestSha(
      plugin.source.url,
      plugin.source.ref ?? "main",
    );
    plugin.source.sha = sha;
    console.log(`${plugin.name}: fetched sha → ${sha.slice(0, 7)}`);
  }
}

writeFileSync(MARKETPLACE_PATH, JSON.stringify(marketplace, null, 2) + "\n");
console.log("marketplace.json updated.");
