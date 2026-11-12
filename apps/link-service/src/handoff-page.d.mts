/** A full html page: the pixel sky with a bot on a speech card holding `content`. Script-free; every asset is inline. */
export function handoffPage(page: {
  title: string;
  /** which bot stands on the card: ok is kit (done), go is a blue bot (on the way), oops is a coral one (it failed) */
  mood?: "ok" | "go" | "oops";
  /** trusted markup; escape every value before it goes in */
  content: string;
  /** extra trusted markup for <head> */
  head?: string;
}): string;
