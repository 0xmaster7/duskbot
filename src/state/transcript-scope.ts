import { createContext } from "react";

/** Which workspace's transcript shelf the store under it reads and saves; `null` is the page's own workspace. */
export const TranscriptShelfScope = createContext<string | null>(null);
