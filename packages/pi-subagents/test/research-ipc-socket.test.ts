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
    let cleaned = false;
    const cleanup = (): void => {
      if (cleaned) {
        return;
      }
      cleaned = true;
      clearTimeout(timer);
      sock.off("data", onData);
      sock.off("error", onError);
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("timeout"));
    }, timeout);
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
      if (frame[4] !== PROTOCOL_VERSION) {
        return false;
      }

      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(frame.subarray(5).toString("utf-8"));
      } catch (err) {
        cleanup();
        reject(err instanceof Error ? err : new Error(String(err)));
        return true;
      }
      cleanup();
      resolve(msg);
      return true;
    }

    function onData(data: Buffer): void {
      buffer = Buffer.concat([buffer, data]);
      tryParse();
    }

    function onError(err: Error): void {
      cleanup();
      reject(err);
    }

    sock.on("data", onData);
    sock.on("error", onError);
  });
}

// ── Mock daemon helpers ────────────────────────────────────────────────────

/** Mutable holder so async mock-daemon handlers can capture the submit. */
interface SubmitCapture {
  submit: Record<string, unknown> | null;
}

/** Mutable holder so async mock-daemon handlers can capture the socket. */
interface SocketCapture {
  sock: Socket | null;
}

/** Read the next frame and extract its report.submit payload, or null. */
async function readSubmitFrame(
  sock: Socket,
): Promise<Record<string, unknown> | null> {
  const msg = await readMockFrame(sock);
  return (msg["report.submit"] as Record<string, unknown>) ?? null;
}

/** review.ack frame for a report.submit. */
function encodeAckFrame(
  submit: Record<string, unknown> | null,
  status: string,
  reason?: string,
): Buffer {
  return encodeDaemon({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    "review.ack": {
      request_id: submit?.request_id,
      status,
      ...(status === "accepted" ? { session_id: randomUUID() } : {}),
      ...(reason !== undefined ? { reason } : {}),
    },
  });
}

/** report.completed frame for a report.submit. */
function encodeCompletedFrame(submit: Record<string, unknown> | null): Buffer {
  return encodeDaemon({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    "report.completed": {
      request_id: submit?.request_id,
      report: submit?.content,
    },
  });
}

/**
 * Mock-daemon handler: read report.submit, ack it accepted, then send
 * report.completed. Captures the submit for later assertions.
 */
async function ackSubmitAndComplete(
  sock: Socket,
  capture: SubmitCapture,
  done: () => void,
): Promise<void> {
  const submit = await readSubmitFrame(sock);
  capture.submit = submit;
  sock.write(encodeAckFrame(submit, "accepted"));
  sock.write(encodeCompletedFrame(submit));
  done();
}

/** Mock-daemon handler: read report.submit and ack it rejected. */
async function rejectSubmit(sock: Socket, done: () => void): Promise<void> {
  const submit = await readSubmitFrame(sock);
  sock.write(encodeAckFrame(submit, "rejected", "no_active_session"));
  done();
}

/**
 * Mock-daemon handler: read report.submit, then write review.ack and
 * report.completed coalesced into a single buffer write — exercises
 * readOneFrame's buffered-data handling.
 */
async function ackSubmitAndCompleteCoalesced(
  sock: Socket,
  capture: SubmitCapture,
  done: () => void,
): Promise<void> {
  const submit = await readSubmitFrame(sock);
  capture.submit = submit;
  sock.write(
    Buffer.concat([
      encodeAckFrame(submit, "accepted"),
      encodeCompletedFrame(submit),
    ]),
  );
  done();
}

/** Mock-daemon handler: capture the socket and read a session.register frame. */
async function captureSessionRegister(
  sock: Socket,
  socketCapture: SocketCapture,
  done: () => void,
): Promise<void> {
  socketCapture.sock = sock;
  const msg = await readMockFrame(sock);
  expect(msg["session.register"]).toBeDefined();
  done();
}

/**
 * Mock-daemon handler: read session.register, then keep reading until the
 * session.unregister frame arrives.
 */
async function captureRegisterThenUnregister(
  sock: Socket,
  onRegistered: () => void,
  onUnregistered: (msg: Record<string, unknown>) => void,
): Promise<void> {
  const reg = await readMockFrame(sock);
  expect(reg["session.register"]).toBeDefined();
  onRegistered();
  const unreg = await readMockFrame(sock);
  onUnregistered(unreg);
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
    vi.unstubAllEnvs();
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

      let resolveFrame!: (msg: Record<string, unknown>) => void;
      const receivedPromise = new Promise<Record<string, unknown>>(
        (resolve) => {
          resolveFrame = resolve;
        },
      );
      mock.onConnection = (sock) => {
        readMockFrame(sock).then(resolveFrame);
      };

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
      vi.stubEnv("PI_RSH_PARENT_SESSION_ID", randomUUID());

      const captured: SubmitCapture = { submit: null };
      let resolveReceived!: () => void;
      const receivedPromise = new Promise<void>((resolve) => {
        resolveReceived = resolve;
      });
      mock.onConnection = (sock) => {
        void ackSubmitAndComplete(sock, captured, resolveReceived);
      };

      await ipc.reportBack(REPORT);
      await receivedPromise;
      expect(captured.submit).not.toBeNull();
    });

    it("falls back when daemon rejects", async () => {
      vi.stubEnv("PI_RSH_PARENT_SESSION_ID", randomUUID());

      const fallbackCalled = vi.fn();
      ipc.setFallbackReporter(async (report) => {
        fallbackCalled(report);
      });

      let resolveAckSent!: () => void;
      const ackSent = new Promise<void>((resolve) => {
        resolveAckSent = resolve;
      });
      mock.onConnection = (sock) => {
        void rejectSubmit(sock, resolveAckSent);
      };

      await ipc.reportBack(REPORT);
      await ackSent;
      expect(fallbackCalled).toHaveBeenCalledTimes(1);
      expect(fallbackCalled).toHaveBeenCalledWith(REPORT);
    });

    it("falls back when PI_RSH_PARENT_SESSION_ID is not set", async () => {
      vi.stubEnv("PI_RSH_PARENT_SESSION_ID", undefined);

      const fallbackCalled = vi.fn();
      ipc.setFallbackReporter(async (report) => {
        fallbackCalled(report);
      });

      await ipc.reportBack(REPORT);
      expect(fallbackCalled).toHaveBeenCalledTimes(1);
      expect(fallbackCalled).toHaveBeenCalledWith(REPORT);
    });

    it("handles coalesced ack+completed in a single read", async () => {
      vi.stubEnv("PI_RSH_PARENT_SESSION_ID", randomUUID());

      const captured: SubmitCapture = { submit: null };
      let resolveDone!: () => void;
      const done = new Promise<void>((resolve) => {
        resolveDone = resolve;
      });
      mock.onConnection = (sock) => {
        void ackSubmitAndCompleteCoalesced(sock, captured, resolveDone);
      };

      await ipc.reportBack(REPORT);
      await done;
      expect(captured.submit).not.toBeNull();
    });

    it("times out and falls back when daemon never responds", async () => {
      vi.stubEnv("PI_RSH_PARENT_SESSION_ID", randomUUID());
      vi.useFakeTimers();

      const fallbackCalled = vi.fn();
      ipc.setFallbackReporter(async (report) => {
        fallbackCalled(report);
      });

      // Don't respond at all — the daemon accepts the connection but
      // never writes a review.ack frame.
      let connected = false;
      let resolveConnected!: () => void;
      const connectedPromise = new Promise<void>((resolve) => {
        resolveConnected = resolve;
      });
      mock.onConnection = () => {
        connected = true;
        resolveConnected();
      };

      const reportPromise = ipc.reportBack(REPORT);
      await connectedPromise;
      expect(connected).toBe(true);

      // Advance past REPORT_TIMEOUT to trigger the timeout fallback
      vi.advanceTimersByTime(15_000);

      await reportPromise;
      expect(fallbackCalled).toHaveBeenCalledTimes(1);
      expect(fallbackCalled).toHaveBeenCalledWith(REPORT);

      vi.useRealTimers();
    });
  });

  describe("incoming report.delivered (receiver flow)", () => {
    it("fires onReport handler when daemon sends report.delivered", async () => {
      const stop = await ipc.start();

      let resolveReport!: (report: ResearchReport | null) => void;
      const receivedReport = new Promise<ResearchReport | null>((resolve) => {
        resolveReport = resolve;
      });
      ipc.onReport((report) => resolveReport(report));

      const sessionSock: SocketCapture = { sock: null };
      let resolveConnected!: () => void;
      const connectedPromise = new Promise<void>((resolve) => {
        resolveConnected = resolve;
      });
      mock.onConnection = (sock) => {
        void captureSessionRegister(sock, sessionSock, resolveConnected);
      };

      await ipc.register(randomUUID(), "/tmp/test-project");
      await connectedPromise;

      const requestId = randomUUID();
      const content = JSON.stringify(REPORT);
      sessionSock.sock!.write(
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
      const completed = await readMockFrame(sessionSock.sock!);
      const payload =
        (completed["report.completed"] as
          | Record<string, unknown>
          | undefined) ?? null;
      expect(payload).not.toBeNull();
      // Vitest's negated assertion doesn't narrow the type for TS
      expect(payload!.request_id).toBe(requestId);
      expect(payload!.report).toBe(content);

      stop();
    });
  });

  describe("start() cleanup", () => {
    it("disposer sends session.unregister with the registered id", async () => {
      const stop = await ipc.start();
      const sessionId = randomUUID();

      let unregResolve!: (msg: Record<string, unknown>) => void;
      const unregisterPromise = new Promise<Record<string, unknown>>(
        (resolve) => {
          unregResolve = resolve;
        },
      );
      // Resolves once the mock daemon has read the register frame and is
      // listening for the next one — arming the unregister read before the
      // test calls stop(), so no frame is missed.
      let resolveRegistered!: () => void;
      const registered = new Promise<void>((resolve) => {
        resolveRegistered = resolve;
      });
      mock.onConnection = (sock) => {
        void captureRegisterThenUnregister(
          sock,
          resolveRegistered,
          unregResolve,
        );
      };

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
    it("returns an unsubscribe function that stops further delivery", async () => {
      await ipc.start();

      const handler = vi.fn();
      const unsubscribe = ipc.onReport(handler);
      expect(typeof unsubscribe).toBe("function");

      // Register to get a session socket
      const sessionSock: SocketCapture = { sock: null };
      let resolveConnected!: () => void;
      const connected = new Promise<void>((resolve) => {
        resolveConnected = resolve;
      });
      mock.onConnection = (sock) => {
        void captureSessionRegister(sock, sessionSock, resolveConnected);
      };
      await ipc.register(randomUUID(), "/tmp/test-project");
      await connected;

      // Deliver a report.delivered frame
      sessionSock.sock!.write(
        encodeDaemon({
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          "report.delivered": {
            request_id: randomUUID(),
            content: JSON.stringify(REPORT),
          },
        }),
      );

      // Wait for dispatch to fire the handler
      await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
      expect(handler).toHaveBeenCalledWith(REPORT);

      // Unsubscribe and deliver another frame — handler should not fire again
      unsubscribe();
      sessionSock.sock!.write(
        encodeDaemon({
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          "report.delivered": {
            request_id: randomUUID(),
            content: JSON.stringify(REPORT),
          },
        }),
      );

      // Small delay to let any async dispatch settle
      await new Promise((r) => setTimeout(r, 50));
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe("poll", () => {
    it("is a no-op", async () => {
      await expect(ipc.poll()).resolves.toBeUndefined();
    });
  });
});
