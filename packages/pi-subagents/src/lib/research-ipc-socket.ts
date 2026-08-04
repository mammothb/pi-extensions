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
export const SOCKET_FILENAME = "research-ipc.sock";
const CONNECT_TIMEOUT = 2_000; // ms
const REPORT_TIMEOUT = 10_000; // ms, overall report.submit → report.completed

type DecodeResult =
  | { kind: "incomplete" }
  | { kind: "invalid" }
  | { kind: "message"; msg: Record<string, unknown> };

/**
 * Decode the next complete frame from a buffer holder. Returns a
 * discriminated result: "incomplete" when the buffer doesn't yet contain a
 * full frame (nothing consumed), "invalid" when a full frame was consumed
 * but could not be decoded, or "message" with the parsed JSON. Mutates
 * buffer.buf to consume complete frames.
 */
function decodeFrame(buffer: { buf: Buffer }): DecodeResult {
  if (buffer.buf.length < 4) {
    return { kind: "incomplete" };
  }
  const len = buffer.buf.readUInt32BE(0);
  if (buffer.buf.length < 4 + len) {
    return { kind: "incomplete" };
  }

  const frame = buffer.buf.subarray(0, 4 + len);
  buffer.buf = buffer.buf.subarray(4 + len);

  if (frame.length < 5) {
    return { kind: "invalid" };
  }
  if (frame[4] !== PROTOCOL_VERSION) {
    return { kind: "invalid" };
  }

  try {
    const parsed: unknown = JSON.parse(frame.subarray(5).toString("utf-8"));
    if (typeof parsed !== "object" || parsed === null) {
      return { kind: "invalid" };
    }
    return { kind: "message", msg: parsed as Record<string, unknown> };
  } catch {
    return { kind: "invalid" };
  }
}

/** Only treat payloads matching the ResearchReport shape as deliverable. */
function isResearchReport(value: unknown): value is ResearchReport {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const r = value as Record<string, unknown>;
  return (
    typeof r.sessionId === "string" &&
    typeof r.task === "string" &&
    typeof r.output === "string" &&
    typeof r.completedAt === "string"
  );
}

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
      reject(new Error("read timeout"));
    }, timeout);

    // Early check — maybe we already have a frame in the buffer
    tryNext();

    function tryNext(): void {
      for (;;) {
        const result = decodeFrame(buffer);
        if (result.kind === "incomplete") {
          return;
        }
        if (result.kind === "message") {
          cleanup();
          resolve(result.msg);
          return;
        }
        // invalid frame was consumed — try the next one
      }
    }

    function onData(data: Buffer): void {
      buffer.buf = Buffer.concat([buffer.buf, data]);
      tryNext();
    }

    function onError(err: Error): void {
      cleanup();
      reject(err);
    }

    sock.on("data", onData);
    sock.on("error", onError);
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

  private fileIPC: ResearchReceiver | null = null;

  /** Inject a file-based IPC for fallback report consumption. */
  setFileIPC(fileIPC: ResearchReceiver): void {
    this.fileIPC = fileIPC;
  }

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
        reject(err instanceof Error ? err : new Error(String(err)));
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

      const connectErrorHandler = (err: Error): void => {
        clearTimeout(timer);
        reject(err);
      };

      sock.on("connect", () => {
        clearTimeout(timer);
        sock.off("error", connectErrorHandler);

        // Persistent error/close handlers for the session socket.
        // On failure or closure, log the event, clear this.socket only
        // when it references this socket, and dispose the read loop so
        // the session can re-register and dispatch does not write to a
        // dead connection.
        sock.on("error", (err) => {
          console.error(`pi-subagents: session socket error: ${err.message}`);
          if (this.socket === sock) {
            this.socket = null;
            this.readLoopDisposer?.();
            this.readLoopDisposer = null;
            this.buffer = Buffer.alloc(0);
          }
        });

        sock.on("close", (hadError) => {
          // Clean shutdowns (end(), daemon close) are normal; log at error
          // level only when the socket died with an error.
          if (hadError) {
            console.error("pi-subagents: session socket closed with error");
          }
          if (this.socket === sock) {
            this.socket = null;
            this.readLoopDisposer?.();
            this.readLoopDisposer = null;
            this.buffer = Buffer.alloc(0);
          }
        });

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

      sock.on("error", connectErrorHandler);
    });
  }

  // ── ResearchReporter ──────────────────────────────────────────────────

  async reportBack(report: ResearchReport): Promise<void> {
    const parentSessionId = process.env.PI_RSH_PARENT_SESSION_ID;
    try {
      if (parentSessionId) {
        await this.reportBackSocket(report, parentSessionId);
        return;
      }
    } catch {
      // fall through to file IPC below
    }
    await this.swallowFallback(report);
  }

  /**
   * Run the fallback reporter, converting any failure into a resolved
   * promise so reportBack never rejects and the child's /rsh-report
   * command always settles.
   */
  private async swallowFallback(report: ResearchReport): Promise<void> {
    try {
      await this.fallback(report);
    } catch (err) {
      console.error(
        `pi-subagents: fallback report delivery failed: ${err instanceof Error ? err.message : String(err)}`,
      );
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

      let settled = false;

      const fail = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        sock.destroy();
        // Resolve even when the fallback itself fails — a rejected fallback
        // must not leave the reportBack promise hanging or reject it.
        this.swallowFallback(report).then(resolve);
      };

      const succeed = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
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
    let fileStop: Unsubscribe | null = null;
    if (this.fileIPC) {
      try {
        fileStop = await this.fileIPC.start();
      } catch {
        // FileIPC start failure is non-fatal; socket push still works
      }
    }

    return () => {
      this.started = false;
      fileStop?.();
      const sid = this.sessionId;
      this.sessionId = null;
      this.readLoopDisposer?.();
      this.readLoopDisposer = null;
      this.buffer = Buffer.alloc(0);
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

  /** Delegates to the injected FileIPC for file-based reports. */
  async poll(): Promise<void> {
    if (this.fileIPC) {
      await this.fileIPC.poll();
    }
  }

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
    const buf = { buf: this.buffer };
    for (;;) {
      const result = decodeFrame(buf);
      if (result.kind === "incomplete") {
        break;
      }
      this.buffer = buf.buf;
      if (result.kind === "message") {
        this.dispatch(result.msg);
      }
      // invalid frames were consumed — skip and keep decoding so valid
      // frames that follow them are processed immediately
    }
    this.buffer = buf.buf;
  }

  /** Handle an incoming message from the daemon on the session connection. */
  private dispatch(msg: Record<string, unknown>): void {
    const delivered = msg["report.delivered"] as
      | Record<string, unknown>
      | undefined;
    if (!delivered) {
      return;
    }

    const content =
      typeof delivered.content === "string" ? delivered.content : "";
    const requestId =
      typeof delivered.request_id === "string" ? delivered.request_id : "";

    // Parse the report — only send report.completed on success. The wire
    // is untrusted (another process), so validate the shape before any
    // state update or handler call.
    let report: ResearchReport;
    try {
      const parsed: unknown = JSON.parse(content);
      if (!isResearchReport(parsed)) {
        return; // not a report — don't ack or notify handlers
      }
      report = parsed;
    } catch {
      return; // invalid content — don't echo report.completed
    }

    updateResearchSessionStatus(report.sessionId, "completed");
    for (const handler of this.handlers) {
      try {
        handler(report);
      } catch {
        // isolate each handler so one failure doesn't prevent others
      }
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

  private async fallback(report: ResearchReport): Promise<void> {
    if (this.fallbackReportBack) {
      return this.fallbackReportBack(report);
    }
  }
}
