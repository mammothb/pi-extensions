import { vi } from "vitest";

export function createMockPi(execResult: {
  stdout: string;
  stderr: string;
  code: number;
}) {
  return {
    exec: vi.fn().mockResolvedValue(execResult),
  };
}
