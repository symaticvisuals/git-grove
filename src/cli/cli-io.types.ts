/** Where a command writes and the folder it runs in. */
export type CliIo = {
  out: (s: string) => void;
  err: (s: string) => void;
  cwd: string;
};
