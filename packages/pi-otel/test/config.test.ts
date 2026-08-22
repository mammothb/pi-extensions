import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyEnv,
  DEFAULT_CONFIG,
  loadConfig,
  mergeConfig,
  parseHeaders,
} from "../src/config.js";

const EMPTY_ENV = {} as NodeJS.ProcessEnv;

describe("mergeConfig", () => {
  it("returns a copy of base for empty overrides", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, {});
    expect(merged).toEqual(DEFAULT_CONFIG);
    expect(merged).not.toBe(DEFAULT_CONFIG);
    expect(merged.capture).not.toBe(DEFAULT_CONFIG.capture);
  });

  it("does not mutate base", () => {
    const base = structuredClone(DEFAULT_CONFIG);
    mergeConfig(base, {
      endpoint: "http://x:4318",
      capture: { prompts: true },
    });
    expect(base).toEqual(DEFAULT_CONFIG);
  });

  it("merges known fields and ignores unknown/typed-wrong fields", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, {
      endpoint: "http://collector:4318",
      enabled: false,
      summaryLength: 128,
      notAField: true,
      sampleRatio: "not-a-number",
    });
    expect(merged.endpoint).toBe("http://collector:4318");
    expect(merged.enabled).toBe(false);
    expect(merged.summaryLength).toBe(128);
    expect(merged.sampleRatio).toBe(DEFAULT_CONFIG.sampleRatio); // wrong type ignored
  });

  it("merges capture flags per-key", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, {
      capture: { toolResults: true },
    });
    expect(merged.capture.toolResults).toBe(true);
    expect(merged.capture.prompts).toBe(false);
    expect(merged.capture.toolArgs).toBe(false);
    expect(merged.capture.providerPayloads).toBe(false);
  });

  it("replaces headers wholesale", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, {
      headers: { Authorization: "Bearer abc" },
    });
    expect(merged.headers).toEqual({ Authorization: "Bearer abc" });
  });
});

describe("applyEnv", () => {
  it("returns defaults for empty env", () => {
    expect(applyEnv(DEFAULT_CONFIG, EMPTY_ENV)).toEqual(DEFAULT_CONFIG);
  });

  it("lets OTEL_EXPORTER_OTLP_ENDPOINT override the base endpoint", () => {
    const cfg = applyEnv(DEFAULT_CONFIG, {
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://from-env:4318",
    });
    expect(cfg.endpoint).toBe("http://from-env:4318");
    expect(cfg.tracesEndpoint).toBe("http://from-env:4318/v1/traces");
    expect(cfg.metricsEndpoint).toBe("http://from-env:4318/v1/metrics");
  });

  it("overrides only the traces endpoint when OTEL_EXPORTER_OTLP_TRACES_ENDPOINT is set", () => {
    const cfg = applyEnv(
      { ...DEFAULT_CONFIG, endpoint: "http://base:4318" },
      {
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://traces:4318/v1/traces",
      },
    );
    expect(cfg.tracesEndpoint).toBe("http://traces:4318/v1/traces");
    expect(cfg.metricsEndpoint).toBe("http://base:4318/v1/metrics");
  });

  it("lets PI_OTEL_ENABLED=false override base enabled", () => {
    const cfg = applyEnv(
      { ...DEFAULT_CONFIG, enabled: true },
      {
        PI_OTEL_ENABLED: "false",
      },
    );
    expect(cfg.enabled).toBe(false);
  });

  it("lets OTEL_SERVICE_NAME override serviceName", () => {
    const cfg = applyEnv(DEFAULT_CONFIG, { OTEL_SERVICE_NAME: "from-env" });
    expect(cfg.serviceName).toBe("from-env");
  });

  it("lets PI_OTEL_CAPTURE_* override capture flags", () => {
    const cfg = applyEnv(DEFAULT_CONFIG, {
      PI_OTEL_CAPTURE_PROMPTS: "true",
      PI_OTEL_CAPTURE_TOOL_ARGS: "1",
    });
    expect(cfg.capture.prompts).toBe(true);
    expect(cfg.capture.toolArgs).toBe(true);
    expect(cfg.capture.toolResults).toBe(false);
    expect(cfg.capture.providerPayloads).toBe(false);
  });

  it("merges OTEL_EXPORTER_OTLP_HEADERS over file headers", () => {
    const base = { ...DEFAULT_CONFIG, headers: { "X-Tenant": "acme" } };
    const cfg = applyEnv(base, {
      OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer abc",
    });
    expect(cfg.headers).toEqual({
      "X-Tenant": "acme",
      Authorization: "Bearer abc",
    });
  });
});

describe("loadConfig", () => {
  let tmpDir: string;
  let agentDir: string;
  let projectDir: string;
  let prevAgentDir: string | undefined;

  beforeEach(() => {
    tmpDir = join(
      tmpdir(),
      `pi-otel-config-test-${Date.now()}-${randomUUID().slice(0, 8)}`,
    );
    agentDir = join(tmpDir, "agent");
    projectDir = join(tmpDir, "project");
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(join(projectDir, ".pi"), { recursive: true });

    prevAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
  });

  afterEach(() => {
    if (prevAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = prevAgentDir;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeGlobal(content: unknown): void {
    writeFileSync(join(agentDir, "pi-otel.json"), JSON.stringify(content));
  }

  function writeProject(content: unknown): void {
    writeFileSync(
      join(projectDir, ".pi", "pi-otel.json"),
      JSON.stringify(content),
    );
  }

  it("returns defaults when no config files exist", () => {
    expect(loadConfig(projectDir, EMPTY_ENV)).toEqual(DEFAULT_CONFIG);
  });

  it("loads global pi-otel.json", () => {
    writeGlobal({ endpoint: "http://global:4318" });
    const cfg = loadConfig(projectDir, EMPTY_ENV);
    expect(cfg.endpoint).toBe("http://global:4318");
    expect(cfg.tracesEndpoint).toBe("http://global:4318/v1/traces");
  });

  it("project config overrides global per-key", () => {
    writeGlobal({ endpoint: "http://global:4318", summaryLength: 100 });
    writeProject({ endpoint: "http://project:4318" });
    const cfg = loadConfig(projectDir, EMPTY_ENV);
    expect(cfg.endpoint).toBe("http://project:4318");
    expect(cfg.summaryLength).toBe(100); // global survives
  });

  it("env overrides file config", () => {
    writeGlobal({ endpoint: "http://file:4318" });
    const cfg = loadConfig(projectDir, {
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://env:4318",
    });
    expect(cfg.endpoint).toBe("http://env:4318");
  });

  it("resolves env:/file: indirection in header values", () => {
    writeFileSync(join(tmpDir, "key.txt"), "file-secret");
    process.env.PI_OTEL_TEST_SECRET = "env-secret";
    try {
      writeGlobal({
        headers: {
          "X-From-File": `file:${join(tmpDir, "key.txt")}`,
          "X-From-Env": "env:PI_OTEL_TEST_SECRET",
          "X-Literal": "plain",
        },
      });
      const cfg = loadConfig(projectDir, EMPTY_ENV);
      expect(cfg.headers).toEqual({
        "X-From-File": "file-secret",
        "X-From-Env": "env-secret",
        "X-Literal": "plain",
      });
    } finally {
      delete process.env.PI_OTEL_TEST_SECRET;
    }
  });
});

describe("parseHeaders", () => {
  it("parses key=value pairs", () => {
    expect(parseHeaders("Authorization=Bearer abc,X-Tenant=acme")).toEqual({
      Authorization: "Bearer abc",
      "X-Tenant": "acme",
    });
  });

  it("handles values containing =", () => {
    expect(parseHeaders("key=a=b=c")).toEqual({ key: "a=b=c" });
  });

  it("skips malformed pairs", () => {
    expect(parseHeaders("noequals,=val,ok=1")).toEqual({ ok: "1" });
  });

  it("returns empty record for undefined/empty", () => {
    expect(parseHeaders(undefined)).toEqual({});
    expect(parseHeaders("")).toEqual({});
  });
});
