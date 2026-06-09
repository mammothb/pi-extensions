import {
  type KeybindingDefinitions,
  type KeybindingsConfig,
  KeybindingsManager,
  TUI_KEYBINDINGS,
} from "@earendil-works/pi-tui";

// Register pi-ask keybinding IDs in the global Keybindings interface so
// TypeScript provides autocomplete in keybindings.json.
declare module "@earendil-works/pi-tui" {
  interface Keybindings {
    "pi-ask.cursorUp": true;
    "pi-ask.cursorDown": true;
    "pi-ask.prevTab": true;
    "pi-ask.nextTab": true;
  }
}

export const PI_ASK_KEYBINDINGS: KeybindingDefinitions = {
  "pi-ask.cursorUp": {
    defaultKeys: ["up", "k"],
    description: "Move highlight up (ask tool)",
  },
  "pi-ask.cursorDown": {
    defaultKeys: ["down", "j"],
    description: "Move highlight down (ask tool)",
  },
  "pi-ask.prevTab": {
    defaultKeys: ["left", "h"],
    description: "Switch to previous question tab (ask tool)",
  },
  "pi-ask.nextTab": {
    defaultKeys: ["right", "l"],
    description: "Switch to next question tab (ask tool)",
  },
};

/**
 * Create a KeybindingsManager that includes pi-ask bindings merged on top of
 * the TUI defaults, preserving any user overrides from the base manager.
 */
export function createAskKeybindings(
  baseUserBindings?: KeybindingsConfig,
): KeybindingsManager {
  const mergedDefs = { ...TUI_KEYBINDINGS, ...PI_ASK_KEYBINDINGS };
  return new KeybindingsManager(mergedDefs, baseUserBindings ?? {});
}
