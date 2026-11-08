import { createContext } from "react";

/** A page that slides in builds its transcript offscreen first: `onWhole` is called once every row has mounted. */
export interface TranscriptStaging {
  onWhole?: () => void;
}

export const TranscriptStaging = createContext<TranscriptStaging>({});
