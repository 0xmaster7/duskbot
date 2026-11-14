import { useMemo } from "react";
import { X } from "../icons";
import { t } from "@/lib/i18n";
import { closeSignIn, useSignInOpen } from "@/lib/sign-in-sheet";
import { AccountStep } from "./onboarding/AccountStep";
import { funnelAccount } from "./onboarding/funnel-account";

/** The sign-in, as a sheet over whatever the person was doing: the first run's own account step (an emailed code, or
 *  Google, Apple or X in the browser, which comes back by itself), then back to what they were doing. */
export function SignInSheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const account = useMemo(() => funnelAccount(), []);
  if (!account) return null;
  return <div className="ui-scrim fixed inset-0 z-[70] flex items-center justify-center p-4" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div role="dialog" aria-modal="true" aria-labelledby="welcome-title" data-sign-in-sheet="" className="relative max-h-full w-full max-w-[520px] overflow-y-auto rounded-[20px] bg-app shadow-xl">
      <button type="button" onClick={onClose} aria-label={t("accounts.close")} className="absolute end-4 top-4 z-10 grid size-8 place-items-center rounded-full text-ink-secondary hover:bg-ink/[0.06] hover:text-ink">
        <X size={16} />
      </button>
      <AccountStep account={account} known={null} onDone={onDone} onSkip={null} />
    </div>
  </div>;
}

/** Mounted once on the app's page: openSignIn() anywhere shows the sheet. */
export function SignInSheetHost() {
  const request = useSignInOpen();
  if (!request) return null;
  return <SignInSheet onClose={closeSignIn} onDone={() => { const then = request.then; closeSignIn(); then?.(); }} />;
}
