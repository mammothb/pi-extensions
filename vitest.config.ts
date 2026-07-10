import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      enabled: true,
      provider: "v8",
      include: ["src/**/*.ts"],
    },
    projects: [
      {
        test: {
          name: "pi-eval",
          root: "./packages/pi-eval",
          include: ["test/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "pi-ghsearch",
          root: "./packages/pi-ghsearch",
          include: ["test/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "pi-toast",
          root: "./packages/pi-toast",
        },
      },
      {
        test: {
          name: "pi-webfetch",
          root: "./packages/pi-webfetch",
        },
      },
      {
        test: {
          name: "pi-websearch",
          root: "./packages/pi-websearch",
        },
      },
      {
        test: {
          name: "pi-ask",
          root: "./packages/pi-ask",
          include: ["test/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "pi-memory",
          root: "./packages/pi-memory",
          include: ["test/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "pi-permissions",
          root: "./packages/pi-permissions",
          include: ["test/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "pi-stats",
          root: "./packages/pi-stats",
          include: ["test/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "pi-office",
          root: "./packages/pi-office",
        },
      },
      {
        test: {
          name: "pi-trigger",
          root: "./packages/pi-trigger",
          include: ["test/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "pi-web",
          root: "./packages/pi-web",
          include: ["test/**/*.test.ts"],
        },
      },
    ],
  },
});
