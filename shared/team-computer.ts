/** A named, workspace-owned sandboxed VPS computer. Assignment grants one
 * team's Auto bots access to its shared desktop, files and Chromium session. */
export interface TeamComputer {
  id: string;
  name: string;
  section: string | null;
  /** The implicit computer shared only within one personal workspace. */
  scope?: "workspace";
  state: string;
  held: boolean;
  problem?: string;
}

export interface TeamComputersPayload {
  computers: TeamComputer[];
  configured: boolean;
  problem?: string;
}
