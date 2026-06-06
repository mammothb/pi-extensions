import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  {
    test: {
      name: "pi-ghsearch",
      root: "./packages/pi-ghsearch",
      include: ["test/**/*.test.ts"],
      coverage: {
        enabled: true,
        provider: "v8",
        include: ["src/**/*.ts"],
      },
    },
  },
  {
    test: {
      name: "pi-webfetch",
      root: "./packages/pi-webfetch",
      coverage: {
        enabled: true,
        provider: "v8",
        include: ["src/**/*.ts"],
      },
    },
  },
  {
    test: {
      name: "pi-websearch",
      root: "./packages/pi-websearch",
      coverage: {
        enabled: true,
        provider: "v8",
        include: ["src/**/*.ts"],
      },
    },
  },
]);
