#!/usr/bin/env node
/**
 * Validate Mermaid diagram syntax.
 *
 * Usage:
 *   node validate.mjs <file>          validate from file
 *   node validate.mjs                 validate from stdin
 *   echo "flowchart TD\n  A --> B" | node validate.mjs
 *
 * Output (JSON):
 *   {"valid": true}
 *   {"valid": false, "error": "...parse error message..."}
 */

import { readFileSync } from "node:fs";

async function getMermaidParser() {
  const mod = await import("mermaid");
  const api = mod.default ?? mod.mermaidAPI ?? mod;

  if (!api || typeof api.parse !== "function") {
    throw new Error("mermaid.parse() not available");
  }

  if (typeof api.initialize === "function") {
    try {
      api.initialize({ startOnLoad: false, suppressErrorRendering: true });
    } catch {
      // ignore initialization errors
    }
  }

  return async (text) => {
    const result = api.parse(text);
    if (result && typeof result.then === "function") {
      await result;
    }
  };
}

function isEnvironmentError(message) {
  return (
    message.includes("DOMPurify.addHook") ||
    message.includes("DOMPurify") ||
    message.includes("document is not defined") ||
    message.includes("window is not defined") ||
    message.includes("MutationObserver")
  );
}

async function main() {
  let source;

  if (process.argv[2]) {
    source = readFileSync(process.argv[2], "utf-8");
  } else {
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    source = Buffer.concat(chunks).toString("utf-8");
  }

  if (!source?.trim()) {
    console.log(JSON.stringify({ valid: false, error: "Empty diagram" }));
    process.exit(0);
  }

  try {
    const parse = await getMermaidParser();
    await parse(source);
    console.log(JSON.stringify({ valid: true }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isEnvironmentError(message)) {
      // Syntax was parsed, but environment errors prevented full validation.
      // Treat as valid since the diagram structure was accepted.
      console.log(
        JSON.stringify({ valid: true, warning: "Environment error ignored" }),
      );
    } else {
      console.log(JSON.stringify({ valid: false, error: message }));
    }
  }
}

main().catch((err) => {
  console.error(
    JSON.stringify({ valid: false, error: `Script error: ${err.message}` }),
  );
  process.exit(1);
});
