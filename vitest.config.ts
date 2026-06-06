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
    ],
  },
});
