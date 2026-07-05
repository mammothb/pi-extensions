// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI/control char matching
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional control char matching
const CTRL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f]/g;

export const sanitize = (text: string): string =>
  text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(ANSI_RE, "")
    .replace(CTRL_RE, "");
