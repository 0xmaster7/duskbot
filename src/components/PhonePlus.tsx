// The phone composer's round + (Composer.tsx): the + menu.
import type { ComponentProps } from "react";

import { ComposerPlusMenu } from "./ComposerPlusMenu";

type PhonePlusProps = Pick<ComponentProps<typeof ComposerPlusMenu>, "onAttach" | "attachChoices" | "goal" | "teach" | "approval" | "callBotId">;

/** The phone composer's round +: attach, Finish together, approval level and call mode. */
export function PhonePlus(props: PhonePlusProps) {
  return <ComposerPlusMenu {...props} circle />;
}
