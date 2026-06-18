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
          name: "pi-hashline",
          root: "./packages/pi-hashline",
          include: ["test/**/*.test.ts"],
        },
      },
    ],
  },
});
