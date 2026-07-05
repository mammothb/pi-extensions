import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createAutocompleteProviderFactory } from "./src/autocomplete-provider.js";
import { createInputHandler } from "./src/input-handler.js";
import {
  buildDefaultRoots,
  loadPromptsFromDir,
  loadSkills,
} from "./src/loader.js";
import { renderTriggerBatch } from "./src/trigger-renderer.js";
import type { TriggerDefinition } from "./src/types.js";

export default function (pi: ExtensionAPI) {
  const store: {
    skills: Map<string, TriggerDefinition>;
    prompts: Map<string, TriggerDefinition>;
  } = {
    skills: new Map(),
    prompts: new Map(),
  };

  const refresh = (cwd: string) => {
    const { skillRoots, promptDirs } = buildDefaultRoots(cwd);
    store.skills = loadSkills(skillRoots);
    store.prompts = new Map();
    for (const dir of promptDirs) {
      const prompts = loadPromptsFromDir(dir);
      for (const [name, def] of prompts) {
        if (!store.prompts.has(name)) {
          store.prompts.set(name, def);
        }
      }
    }
  };

  const inputHandler = createInputHandler(store);
  let autocompleteRegistered = false;

  pi.on("session_start", async (_event, ctx) => {
    refresh(ctx.cwd);

    if (!autocompleteRegistered) {
      ctx.ui.addAutocompleteProvider(createAutocompleteProviderFactory(store));
      autocompleteRegistered = true;
    }
  });

  pi.on("input", async (event, ctx) => {
    return inputHandler(event, ctx, pi);
  });

  // biome-ignore lint/suspicious/noExplicitAny: message renderer type mismatch is a known pi pattern
  pi.registerMessageRenderer("trigger", renderTriggerBatch as any);
}
