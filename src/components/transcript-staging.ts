import { createContext } from "react";

/** True while the transcript's page is sliding into place: its older rows wait to mount until it settles, so the slide
 * does no layout. Rows that fill the first screen still paint before it moves. */
export const TranscriptStagingPaused = createContext(false);
