// Whether the selected chat is in front of the person, which decides if a reply landing in it counts as read. The
// desktop always shows the chat it has selected; the phone shows its list over the chat it last opened, and a chat under
// the list is not being read.
let covered = false;

export function setChatCovered(value: boolean): void {
  covered = value;
}

export function chatInFront(doc: Pick<Document, "hasFocus"> = document): boolean {
  return !covered && doc.hasFocus();
}
