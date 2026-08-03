import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResearchReport } from "../src/lib/research-ipc.js";
import { SocketIPC } from "../src/lib/research-ipc-socket.js";

// ── Wire codec (mirrors research-ipc-socket.ts) ────────────────────────────

const PROTOCOL_VERSION = 0x01;

function encodeDaemon(msg: Record<string, unknown>): Buffer {
  const json = Buffer.from(JSON.stringify(msg), "utf-8");
  const body = Buffer.concat([Buffer.from([PROTOCOL_VERSION]), json]);
  const len = Buffer.allocUnsafe(4);
  len.writeUInt32BE(body.length);
  return Buffer.concat([len, body]);
}

// ── Mock daemon ────────────────────────────────────────────────────────────

interface MockDaemon {
  socketPath: string;
  /** Per-connection handler. Set before register()/reportBack() connects. */
  onConnection: ((sock: Socket) => void) | null;
  close(): void;
}

/** Spawn a mock daemon on a temp Unix socket. Tests must call close(). */
function startMockDaemon(): MockDaemon {
  const dir = mkdtempSync(join(tmpdir(), "pi-socketipc-test-"));
  const socketPath = join(dir, "research-ipc.sock");

  const mock: MockDaemon = {
    socketPath,
    onConnection: null,
    close: () => {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };

  const server = createServer((sock) => {
    mock.onConnection?.(sock);
  });

  server.listen(socketPath);

  return mock;
}

/**
 * Read one frame from the socket using the same wire protocol as the
 * daemon. Resolves with parsed JSON on success, rejects on error.
 */
function readMockFrame(
  sock: Socket,
  timeout: number = 2000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), timeout);
    let buffer = Buffer.alloc(0);

    function tryParse(): boolean {
      if (buffer.length < 4) {
        return false;
      }
      const len = buffer.readUInt32BE(0);
      if (buffer.length < 4 + len) {
        return false;
      }

      const frame = buffer.subarray(0, 4 + len);
      buffer = buffer.subarray(4 + len);

      if (frame.length < 5) {
        return false;
      }
      const version = frame[4];
      if (version !== PROTOCOL_VERSION) {
        return false;
      }

      const msg = JSON.parse(frame.subarray(5).toString("utf-8"));
      clearTimeout(timer);
      sock.off("data", onData);
      resolve(msg);
      return true;
    }

    function onData(data: Buffer): void {
      buffer = Buffer.concat([buffer, data]);
      tryParse();
    }

    sock.on("data", onData);
    sock.on("error", (err) => {
      clearTimeout(timer);
      sock.off("data", onData);
      reject(err);
    });
  });
}

// ── Fixture ────────────────────────────────────────────────────────────────

const REPORT: ResearchReport = {
  sessionId: "child-abc",
  task: "research task",
  output: "findings here",
  completedAt: new Date().toISOString(),
};

// ── SocketIPC tests ────────────────────────────────────────────────────────

describe("SocketIPC", () => {
  let mock: MockDaemon;
  let ipc: SocketIPC;

  beforeEach(() => {
    mock = startMockDaemon();
    ipc = new SocketIPC(mock.socketPath);
  });

  afterEach(() => {
    mock.close();
  });

  describe("connect", () => {
    it("resolves when daemon socket is listening", async () => {
      await expect(ipc.connect()).resolves.toBeUndefined();
    });

    it("rejects when no daemon is listening", async () => {
      mock.close();
      await expect(ipc.connect()).rejects.toThrow();
    });
  });

  describe("register", () => {
    it("sends a valid session.register frame to the daemon", async () => {
      await ipc.start();

      const receivedPromise = new Promise<Record<string, unknown>>(
        (resolve) => {
          mock.onConnection = (sock) => {
            readMockFrame(sock).then(resolve);
          };
        },
      );

      const sessionId = randomUUID();
      await ipc.register(sessionId, "/tmp/test-project");

      const msg = await receivedPromise;
      const payload =
        (msg["session.register"] as Record<string, unknown>) ?? null;
      expect(payload).not.toBeNull();
      expect(payload.session_id).toBe(sessionId);
      expect(payload.project_path).toBe("/tmp/test-project");
    });

    it("throws if called before start()", async () => {
      await expect(ipc.register(randomUUID(), "/tmp/p")).rejects.toThrow(
        "must call start() before register()",
      );
    });

    it("is a no-op if already registered", async () => {
      await ipc.start();
      await ipc.register(randomUUID(), "/tmp/p");
      // Second call should resolve immediately without error.
      await expect(
        ipc.register(randomUUID(), "/tmp/p"),
      ).resolves.toBeUndefined();
    });
  });

  describe("reportBack", () => {
    it("sends report.submit and resolves on report.completed", async () => {
      process.env.PI_RSH_PARENT_SESSION_ID = randomUUID();

      const receivedPromise = new Promise<void>((resolve) => {
        mock.onConnection = async (sock) => {
          const msg = await readMockFrame(sock);
          const submit =
            (msg["report.submit"] as Record<string, unknown>) ?? null;
          expect(submit).not.toBeNull();

          sock.write(
            encodeDaemon({
              id: randomUUID(),
              timestamp: new Date().toISOString(),
              "review.ack": {
                request_id: submit.request_id,
                status: "accepted",
                session_id: randomUUID(),
              },
            }),
          );

          sock.write(
            encodeDaemon({
              id: randomUUID(),
              timestamp: new Date().toISOString(),
              "report.completed": {
                request_id: submit.request_id,
                report: submit.content,
              },
            }),
          );
          resolve();
        };
      });

      await ipc.reportBack(REPORT);
      await receivedPromise;
      delete process.env.PI_RSH_PARENT_SESSION_ID;
    });

    it("falls back when daemon rejects", async () => {
      process.env.PI_RSH_PARENT_SESSION_ID = randomUUID();

      const fallbackCalled = vi.fn();
      ipc.setFallbackReporter(async (report) => {
        fallbackCalled(report);
      });

      mock.onConnection = async (sock) => {
        const msg = await readMockFrame(sock);
        const submit =
          (msg["report.submit"] as Record<string, unknown>) ?? null;
        sock.write(
          encodeDaemon({
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            "review.ack": {
              request_id: submit.request_id,
              status: "rejected",
              reason: "no_active_session",
            },
          }),
        );
      };

      await ipc.reportBack(REPORT);
      expect(fallbackCalled).toHaveBeenCalledTimes(1);
      expect(fallbackCalled).toHaveBeenCalledWith(REPORT);
      delete process.env.PI_RSH_PARENT_SESSION_ID;
    });

    it("falls back when PI_RSH_PARENT_SESSION_ID is not set", async () => {
      delete process.env.PI_RSH_PARENT_SESSION_ID;

      const fallbackCalled = vi.fn();
      ipc.setFallbackReporter(async (report) => {
        fallbackCalled(report);
      });

      await ipc.reportBack(REPORT);
      expect(fallbackCalled).toHaveBeenCalledTimes(1);
      expect(fallbackCalled).toHaveBeenCalledWith(REPORT);
    });
  });

  describe("incoming report.delivered (receiver flow)", () => {
    it("fires onReport handler when daemon sends report.delivered", async () => {
      const stop = await ipc.start();

      const receivedReport = new Promise<ResearchReport | null>((resolve) => {
        ipc.onReport((report) => resolve(report));
      });

      let sessionSock: Socket | null = null;
      const connectedPromise = new Promise<void>((resolve) => {
        mock.onConnection = async (sock) => {
          sessionSock = sock;
          const msg = await readMockFrame(sock);
          expect(msg["session.register"]).toBeDefined();
          resolve();
        };
      });

      await ipc.register(randomUUID(), "/tmp/test-project");
      await connectedPromise;

      const requestId = randomUUID();
      const content = JSON.stringify(REPORT);
      sessionSock!.write(
        encodeDaemon({
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          "report.delivered": {
            request_id: requestId,
            content,
          },
        }),
      );

      const delivered = await receivedReport;
      expect(delivered).toEqual(REPORT);

      // The session echoes back report.completed for the daemon to relay
      // to the waiting producer.
      const completed = await readMockFrame(sessionSock!);
      const payload =
        (completed["report.completed"] as Record<string, unknown>) ?? null;
      expect(payload).not.toBeNull();
      expect(payload.request_id).toBe(requestId);
      expect(payload.report).toBe(content);

      stop();
    });
  });

  describe("start() cleanup", () => {
    it("disposer sends session.unregister with the registered id", async () => {
      const stop = await ipc.start();
      const sessionId = randomUUID();

      let unregResolve: (msg: Record<string, unknown>) => void;
      const unregisterPromise = new Promise<Record<string, unknown>>(
        (resolve) => {
          unregResolve = resolve;
        },
      );
      // Resolves once the mock daemon has read the register frame and is
      // listening for the next one — arming the unregister read before the
      // test calls stop(), so no frame is missed.
      const registered = new Promise<void>((resolve) => {
        mock.onConnection = async (sock) => {
          const reg = await readMockFrame(sock);
          expect(reg["session.register"]).toBeDefined();
          resolve();
          const unreg = await readMockFrame(sock);
          unregResolve(unreg);
        };
      });

      await ipc.register(sessionId, "/tmp/p");
      await registered;
      stop();

      const msg = await unregisterPromise;
      const payload =
        (msg["session.unregister"] as Record<string, unknown>) ?? null;
      expect(payload).not.toBeNull();
      expect(payload.session_id).toBe(sessionId);
    });
  });

  describe("onReport", () => {
    it("returns an unsubscribe function", async () => {
      const handler = vi.fn();
      const unsubscribe = ipc.onReport(handler);
      expect(typeof unsubscribe).toBe("function");
      unsubscribe();
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("poll", () => {
    it("is a no-op", async () => {
      await expect(ipc.poll()).resolves.toBeUndefined();
    });
  });
});
