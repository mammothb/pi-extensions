import type { BwResolvedConfig } from "./types.js";

const HOME = "~";

export const DEFAULT_CONFIG: BwResolvedConfig = {
  binds: {
    ro: ["/bin", "/etc", "/sbin", "/usr"],
    roTry: [
      "/lib",
      "/lib64",
      `${HOME}/.cargo`,
      `${HOME}/.config`,
      `${HOME}/.local/bin`,
      `${HOME}/.local/share`,
      `${HOME}/.nvm`,
      `${HOME}/.pyenv`,
      `${HOME}/.rustup`,
      `${HOME}/.ssh`,
    ],
    rw: [
      `${HOME}/.cache`,
      `${HOME}/.local/packages`,
      `${HOME}/.npm`,
      `${HOME}/.pi`,
    ],
    docker: "/var/run/docker.sock",
    wsl2: {
      ro: [],
      roTry: [],
    },
  },
  options: {
    clearenv: true,
    env: {},
    path: [],
    tmpfsSize: "512M",
    unshareNet: false,
  },
};
