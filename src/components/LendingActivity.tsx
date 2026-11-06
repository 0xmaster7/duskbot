import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { Card as RowsCard, ItemRow, NoteRow } from "./ListRows";

const ACTIONS: Record<string, LocaleKey> = {
  list_files: "lending.action.listFiles",
  read_file: "lending.action.readFile",
  write_file: "lending.action.writeFile",
  edit_file: "lending.action.writeFile",
  append_file: "lending.action.writeFile",
  delete_file: "lending.action.deleteFile",
  run_command: "lending.action.runCommand",
  computer_tools: "lending.action.screenTools",
  computer_call: "lending.action.screen",
  invalid: "lending.action.invalid",
  internet: "lending.action.website",
  chrome: "lending.action.chrome",
};

/** Security: Electron main keeps this record; a server cannot write to it. */
export function LendingActivityList({ entries }: { entries: DesktopLendingActivity[] | null }) {
  return <RowsCard label={t("lending.activity.title")}>
    {entries && entries.length === 0 && <NoteRow>{t("lending.activity.empty")}</NoteRow>}
    {entries && entries.length > 0 && <ul aria-label={t("lending.activity.title")} className="m-0 flex max-h-56 list-none flex-col overflow-y-auto p-0">
      {entries.map((entry, index) => <li key={`${entry.at}-${index}`}>
        <ItemRow tone={entry.ok ? undefined : "danger"}
          title={`${t(ACTIONS[entry.action] ?? "lending.action.other")}${entry.ok ? "" : ` · ${t("lending.activity.refused")}`}`}
          hint={<><time dateTime={new Date(entry.at).toISOString()} className="tabular-nums">{new Date(entry.at).toLocaleString()}</time>{entry.detail && <> · <span dir="auto" className="break-all">{entry.detail}</span></>}</>} />
      </li>)}
    </ul>}
  </RowsCard>;
}
