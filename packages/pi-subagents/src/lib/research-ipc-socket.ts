import { randomUUID } from "node:crypto";
import { createConnection, type Socket } from "node:net";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type {
  ResearchReceiver,
  ResearchReport,
  ResearchReporter,
  Unsubscribe,
} from "./research-ipc.js";
import { updateResearchSessionStatus } from "./research-state.js";

// ── Frame codec ─────────────────────────────────────────────────────────────

const PROTOCOL_VERSION = 0x01;
const SOCKET_FILENAME = "research-ipc.sock";
const CONNECT_TIMEOUT = 2_000; // ms
const REPORT_TIMEOUT = 10_000; // ms, overall report.submit → report.completed

/**
 * Encode a JSON message into a length-prefixed frame.
 * Wire: [4-byte BE length of version+JSON][0x01 version][JSON]
 */
function encodeFrame(msg: Record<string, unknown>): Buffer {
  const json = Buffer.from(JSON.stringify(msg), "utf-8");
  const body = Buffer.concat([Buffer.from([PROTOCOL_VERSION]), json]);
  const len = Buffer.allocUnsafe(4);
  len.writeUInt32BE(body.length);
  return Buffer.concat([len, body]);
}

/**
 * Read one complete frame from a socket, buffering partial data.
 * Rejects on timeout, connection error, or version mismatch.
 */
function readOneFrame(
  sock: Socket,
  timeout: number,
  buffer: { buf: Buffer },
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    // Early check — maybe we already have a frame in the buffer
    tryNext();

    const timer = setTimeout(() => {
      sock.off("data", onData);
      reject(new Error("read timeout"));
    }, timeout);

    function tryNext(): void {
      while (buffer.buf.length >= 4) {
        const len = buffer.buf.readUInt32BE(0);
        if (buffer.buf.length < 4 + len) {
          return; // incomplete
        }

        const frame = buffer.buf.subarray(0, 4 + len);
        buffer.buf = buffer.buf.subarray(4 + len);

        if (frame.length < 5) {
          continue;
        }
        const version = frame[4];
        if (version !== PROTOCOL_VERSION) {
          continue; // skip unknown version
        }

        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(frame.subarray(5).toString("utf-8"));
        } catch {
          continue; // skip malformed JSON
        }

        clearTimeout(timer);
        sock.off("data", onData);
        resolve(msg);
        return;
      }
    }

    function onData(data: Buffer): void {
      buffer.buf = Buffer.concat([buffer.buf, data]);
      tryNext();
    }

    sock.on("data", onData);
    sock.on("error", (err) => {
      clearTimeout(timer);
      sock.off("data", onData);
      reject(err);
    });
  });
}

// ── Socket IPC implementation ───────────────────────────────────────────────

export class SocketIPC implements ResearchReporter, ResearchReceiver {
  private readonly socketPath: string;
  private readonly handlers = new Set<(report: ResearchReport) => void>();
  private socket: Socket | null = null;
  private sessionId: string | null = null;
  private started = false;
  private readLoopDisposer: (() => void) | null = null;
  private buffer = Buffer.alloc(0);

  /**
   * Called by the factory when the daemon is reachable. SocketIPC falls
   * back to this reporter on every daemon failure path so the child never
   * breaks — file IPC always works as backup.
   */
  setFallbackReporter(
    reporter: (report: ResearchReport) => Promise<void>,
  ): void {
    this.fallbackReportBack = reporter;
  }
  private fallbackReportBack:
    | ((report: ResearchReport) => Promise<void>)
    | null = null;

  // ── Construct ─────────────────────────────────────────────────────────

  constructor(socketPath?: string) {
    this.socketPath = socketPath ?? join(getAgentDir(), SOCKET_FILENAME);
  }

  // ── Health check (factory) ────────────────────────────────────────────

  /** Quick health check — opens and closes a test connection. */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = createConnection(this.socketPath);
      const timer = setTimeout(() => {
        sock.destroy();
        reject(new Error("connect timeout"));
      }, CONNECT_TIMEOUT);
      sock.on("connect", () => {
        clearTimeout(timer);
        sock.destroy();
        resolve();
      });
      sock.on("error", (err) => {
        clearTimeout(timer);
        sock.destroy();
        reject(err);
      });
    });
  }

  // ── Registration ──────────────────────────────────────────────────────

  /**
   * Open a persistent connection to the daemon and send session.register.
   * Called from the session_start hook once the parent session ID is known.
   * Must be called after start().
   */
  async register(sessionId: string, projectPath: string): Promise<void> {
    if (!this.started) {
      throw new Error("must call start() before register()");
    }
    if (this.socket) {
      return; // already registered
    }

    this.sessionId = sessionId;

    return new Promise((resolve, reject) => {
      const sock = createConnection(this.socketPath);
      const timer = setTimeout(() => {
        sock.destroy();
        reject(new Error("register timeout"));
      }, CONNECT_TIMEOUT);

      sock.on("connect", () => {
        clearTimeout(timer);
        sock.write(
          encodeFrame({
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            "session.register": {
              session_id: sessionId,
              project_path: projectPath,
            },
          }),
        );
        this.socket = sock;
        this.armReadLoop(sock);
        resolve();
      });

      sock.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  // ── ResearchReporter ──────────────────────────────────────────────────

  async reportBack(report: ResearchReport): Promise<void> {
    const parentSessionId = process.env.PI_RSH_PARENT_SESSION_ID;
    if (!parentSessionId) {
      return this.fallback(report);
    }

    try {
      await this.reportBackSocket(report, parentSessionId);
    } catch {
      return this.fallback(report);
    }
  }

  private reportBackSocket(
    report: ResearchReport,
    parentSessionId: string,
  ): Promise<void> {
    return new Promise((resolve) => {
      const sock = createConnection(this.socketPath);
      const requestId = randomUUID();
      const buffer = { buf: Buffer.alloc(0) };

      const fail = () => {
        sock.destroy();
        this.fallback(report).then(resolve);
      };

      let settled = false;
      const succeed = () => {
        if (settled) {
          return;
        }
        settled = true;
        sock.destroy();
        resolve();
      };

      const timer = setTimeout(fail, REPORT_TIMEOUT);

      sock.on("connect", async () => {
        sock.write(
          encodeFrame({
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            "report.submit": {
              request_id: requestId,
              session_id: parentSessionId,
              content: JSON.stringify(report),
            },
          }),
        );

        try {
          // Read ack
          const ackMsg = await readOneFrame(sock, REPORT_TIMEOUT, buffer);
          const ack =
            (ackMsg["review.ack"] as Record<string, unknown> | undefined) ??
            null;
          if (!ack || ack.status !== "accepted") {
            fail();
            return;
          }

          // Read response
          const result = await readOneFrame(sock, REPORT_TIMEOUT, buffer);
          if (!result || settled) {
            return;
          }
          if (result["report.completed"] != null) {
            clearTimeout(timer);
            succeed();
          } else {
            fail();
          }
        } catch {
          fail();
        }
      });

      sock.on("error", fail);
    });
  }

  // ── ResearchReceiver ──────────────────────────────────────────────────

  onReport(handler: (report: ResearchReport) => void): Unsubscribe {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  /**
   * Start the receiver side. Returns a cleanup function that closes the
   * daemon socket and sends session.unregister.
   */
  async start(): Promise<Unsubscribe> {
    this.started = true;
    return () => {
      this.started = false;
      const sid = this.sessionId;
      this.sessionId = null;
      this.readLoopDisposer?.();
      this.readLoopDisposer = null;
      if (this.socket && sid) {
        try {
          this.socket.write(
            encodeFrame({
              id: randomUUID(),
              timestamp: new Date().toISOString(),
              "session.unregister": { session_id: sid },
            }),
          );
          // end() flushes pending writes before closing; destroy() would
          // drop the unregister frame if it hasn't hit the wire yet.
          this.socket.end();
        } catch {
          // best-effort
        }
        this.socket = null;
      }
    };
  }

  /** No-op — daemon push delivers reports. */
  async poll(): Promise<void> {}

  // ── Internals ─────────────────────────────────────────────────────────

  private armReadLoop(sock: Socket): void {
    const onData = (data: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, data]);
      this.processBuffer();
    };

    sock.on("data", onData);

    this.readLoopDisposer = () => {
      sock.off("data", onData);
    };
  }

  private processBuffer(): void {
    while (this.buffer.length >= 4) {
      const len = this.buffer.readUInt32BE(0);
      if (this.buffer.length < 4 + len) {
        break; // incomplete frame
      }

      const frame = this.buffer.subarray(0, 4 + len);
      this.buffer = this.buffer.subarray(4 + len);

      if (frame.length < 5) {
        continue;
      }
      const version = frame[4];
      if (version !== PROTOCOL_VERSION) {
        continue;
      }

      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(frame.subarray(5).toString("utf-8"));
      } catch {
        continue;
      }

      this.dispatch(msg);
    }
  }

  /** Handle an incoming message from the daemon on the session connection. */
  private dispatch(msg: Record<string, unknown>): void {
    const delivered = msg["report.delivered"] as
      | Record<string, unknown>
      | undefined;
    if (delivered) {
      const content =
        typeof delivered.content === "string" ? delivered.content : "";
      const requestId =
        typeof delivered.request_id === "string" ? delivered.request_id : "";

      // Parse the report and fire handlers
      try {
        const report: ResearchReport = JSON.parse(content);
        updateResearchSessionStatus(report.sessionId, "completed");
        for (const handler of this.handlers) {
          handler(report);
        }
      } catch {
        // content is not a valid ResearchReport — ignore
      }

      // Echo back report.completed so the daemon forwards it to the
      // waiting producer (child's reportBack).
      if (this.socket && requestId) {
        try {
          this.socket.write(
            encodeFrame({
              id: randomUUID(),
              timestamp: new Date().toISOString(),
              "report.completed": {
                request_id: requestId,
                report: content,
              },
            }),
          );
        } catch {
          // best-effort: producer will time out and fall back to FileIPC
        }
      }
    }
  }

  private async fallback(report: ResearchReport): Promise<void> {
    if (this.fallbackReportBack) {
      return this.fallbackReportBack(report);
    }
  }
}
