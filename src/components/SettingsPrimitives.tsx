import { useId, type ComponentProps, type ReactNode } from "react";
import { Check, ChevronRight, Copy, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useCopyFeedback } from "@/lib/copy-text";
import { t } from "@/lib/i18n";

/** Grok's settings card: white, 14px corners, a half-pixel inset edge drawn as an outline so it takes no room, 8px in. */
export const SIMPLE_CARD = "rounded-[14px] bg-menu py-2 outline-[0.5px] outline-offset-[-0.5px] outline-edge [outline-style:solid]";
/** Grok's buttons inside a settings row: a 30px pill on the faint fill and a half-pixel inset edge, the danger one red. */
export const SIMPLE_BUTTONS = cn(
  "[&_.ui-button]:h-[30px] [&_.ui-button]:gap-1 [&_.ui-button]:rounded-full [&_.ui-button]:border-0 [&_.ui-button]:px-3 [&_.ui-button]:py-1.5 [&_.ui-button]:text-[13px] [&_.ui-button]:leading-[18px] [&_.ui-button]:tracking-[0.015em] [&_.ui-button]:font-normal [&_.ui-button]:whitespace-nowrap [&_.ui-button]:transition-[background-color,color] [&_.ui-button]:duration-[120ms] [&_.ui-button]:ease-out",
  "[&_.ui-button:not(.ui-button-primary,.ui-button-danger)]:bg-ink/[0.06] [&_.ui-button:not(.ui-button-primary,.ui-button-danger)]:text-ink [&_.ui-button:not(.ui-button-primary,.ui-button-danger)]:shadow-[inset_0_0_0_0.5px_color-mix(in_srgb,var(--color-ink)_6%,transparent)] [&_.ui-button:not(.ui-button-primary,.ui-button-danger):enabled:hover]:bg-ink/10",
  "[&_.ui-button:not(.ui-button-primary,.ui-button-danger):disabled]:bg-ink/[0.04] [&_.ui-button:not(.ui-button-primary,.ui-button-danger):disabled]:text-ink/30 [&_.ui-button:disabled]:opacity-100 [&_.ui-button:disabled]:cursor-default",
  "[&_.ui-button-primary]:bg-ink [&_.ui-button-primary]:text-app [&_.ui-button-primary:enabled:hover]:bg-ink/85",
  "[&_.ui-button-danger]:bg-[#e72e3b] [&_.ui-button-danger]:text-white [&_.ui-button-danger:enabled:hover]:bg-[#c82532]",
);

export function Switch({
  checked,
  className,
  ...props
}: Omit<ComponentProps<"button">, "children" | "role" | "aria-checked"> & { checked: boolean }) {
  return (
    <button
      {...props}
      type="button"
      role="switch"
      aria-checked={checked}
      className={cn(
        "relative cursor-pointer h-6 w-11 shrink-0 rounded-full transition-colors enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none",
        "in-data-[settings-look=simple]:h-5 in-data-[settings-look=simple]:w-8 in-data-[settings-look=simple]:transition-[background-color] in-data-[settings-look=simple]:duration-[120ms] in-data-[settings-look=simple]:ease-[ease] in-data-[settings-look=simple]:enabled:hover:brightness-100",
        "in-data-[settings-look=simple]:shadow-[inset_0_0_0_0.5px_color-mix(in_srgb,var(--color-ink)_6%,transparent)] in-data-[settings-look=simple]:outline-none in-data-[settings-look=simple]:focus-visible:outline-2 in-data-[settings-look=simple]:focus-visible:outline-offset-1 in-data-[settings-look=simple]:focus-visible:outline-focus",
        checked
          ? "bg-accent in-data-[settings-look=simple]:bg-accent-border in-data-[settings-look=simple]:enabled:hover:bg-accent"
          : "bg-control in-data-[settings-look=simple]:bg-ink/[0.06] in-data-[settings-look=simple]:enabled:hover:bg-ink/10",
        className,
      )}
    >
      <span
        className={cn(
          "absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white transition-[left] motion-reduce:transition-none",
          "in-data-[settings-look=simple]:top-0.5 in-data-[settings-look=simple]:size-4 in-data-[settings-look=simple]:shadow-[0_1px_3px_0_rgb(28_28_28/0.12)] in-data-[settings-look=simple]:duration-[120ms] in-data-[settings-look=simple]:ease-[ease]",
          checked ? "left-[21px] in-data-[settings-look=simple]:left-[14px]" : "left-[3px] in-data-[settings-look=simple]:left-0.5",
        )}
      />
    </button>
  );
}

export function Card({
  title,
  subtitle,
  children,
}: {
  title?: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-card p-4 max-md:rounded-2xl in-data-[settings-look=simple]:rounded-[14px] in-data-[settings-look=simple]:bg-menu in-data-[settings-look=simple]:px-3.5 in-data-[settings-look=simple]:py-3 in-data-[settings-look=simple]:outline-[0.5px] in-data-[settings-look=simple]:outline-offset-[-0.5px] in-data-[settings-look=simple]:outline-edge in-data-[settings-look=simple]:[outline-style:solid]">
      {title && <div className="text-[16px] font-semibold text-ink in-data-[settings-look=simple]:text-[13px] in-data-[settings-look=simple]:leading-[18px] in-data-[settings-look=simple]:font-medium in-data-[settings-look=simple]:tracking-[-0.08px]">{title}</div>}
      {subtitle && <div className={cn(title && "mt-0.5", "text-[13px] leading-relaxed text-ink-secondary in-data-[settings-look=simple]:leading-[18px] in-data-[settings-look=simple]:tracking-[-0.08px]")}>{subtitle}</div>}
      {children && <div className={title || subtitle ? "mt-4 in-data-[settings-look=simple]:mt-3" : undefined}>{children}</div>}
    </div>
  );
}

export function SettingRow({
  title,
  subtitle,
  children,
  message,
  className,
}: {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  message?: React.ReactNode;
  className?: string;
}) {
  const titleId = useId();
  return (
    <div role="group" aria-labelledby={titleId} className={cn("px-4 in-data-[settings-look=simple]:px-3.5 in-data-[settings-look=simple]:py-2.5", className)}>
      <div className="grid min-w-0 grid-cols-1 items-center gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-6 in-data-[settings-look=simple]:flex in-data-[settings-look=simple]:min-h-7 in-data-[settings-look=simple]:flex-wrap in-data-[settings-look=simple]:justify-between in-data-[settings-look=simple]:gap-x-5 in-data-[settings-look=simple]:gap-y-2">
        <div className="min-w-0 in-data-[settings-look=simple]:flex in-data-[settings-look=simple]:max-w-max in-data-[settings-look=simple]:shrink in-data-[settings-look=simple]:grow in-data-[settings-look=simple]:basis-[min-content] in-data-[settings-look=simple]:flex-col in-data-[settings-look=simple]:gap-0.5 in-data-[settings-look=simple]:[overflow-wrap:break-word]">
          <div id={titleId} className="text-[14px] font-medium text-ink in-data-[settings-look=simple]:flex in-data-[settings-look=simple]:min-h-5 in-data-[settings-look=simple]:items-center in-data-[settings-look=simple]:text-[13px] in-data-[settings-look=simple]:font-normal in-data-[settings-look=simple]:leading-[18px] in-data-[settings-look=simple]:tracking-[-0.08px]">{title}</div>
          {subtitle && <div className="mt-1 text-[12px] leading-relaxed text-pretty text-ink-secondary in-data-[settings-look=simple]:-mt-0.5 in-data-[settings-look=simple]:text-[13px] in-data-[settings-look=simple]:leading-[18px] in-data-[settings-look=simple]:tracking-[-0.08px]">{subtitle}</div>}
        </div>
        <div className="min-w-0 sm:max-w-[240px] in-data-[settings-look=simple]:ml-auto in-data-[settings-look=simple]:flex in-data-[settings-look=simple]:max-w-max in-data-[settings-look=simple]:shrink-0 in-data-[settings-look=simple]:grow in-data-[settings-look=simple]:basis-[max-content] in-data-[settings-look=simple]:flex-col in-data-[settings-look=simple]:items-end in-data-[settings-look=simple]:sm:max-w-max">{children}</div>
      </div>
      {message && <div className="mt-2 text-[12px]">{message}</div>}
    </div>
  );
}

export function SettingsGroup({ label, block, actions, footnote, children }: {
  label?: string;
  block?: string;
  actions?: ReactNode;
  footnote?: ReactNode;
  children: ReactNode;
}) {
  const labelId = useId();
  return (
    <section
      data-settings-block={block}
      aria-labelledby={label ? labelId : undefined}
      className="flex scroll-mt-4 flex-col gap-2 has-[>[data-settings-rows]:empty]:hidden has-[>[data-settings-rows]>:only-child:empty]:hidden"
    >
      {(label || actions) && (
        <div className="flex min-h-4 items-center justify-between gap-3 pl-3.5 pr-1">
          {label && <h3 id={labelId} className="text-[12px] leading-4 font-normal tracking-[0.01em] text-ink-secondary">{label}</h3>}
          {actions}
        </div>
      )}
      {children}
      {footnote && <p className="-mt-0.5 pl-3.5 text-[12px] leading-4 text-ink-tertiary empty:hidden">{footnote}</p>}
    </section>
  );
}

export function SettingsRows({ children }: { children: ReactNode }) {
  return <div data-settings-rows="" className={cn(SIMPLE_CARD, "flex flex-col empty:hidden")}>{children}</div>;
}

export function SettingsDisclosureRow({ id, title, subtitle, trailing, block, open, onToggle, children }: {
  id: string;
  title: string;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  block?: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const regionId = useId();
  return (
    <section data-settings-disclosure={id} data-settings-block={block} className="flex scroll-mt-4 flex-col gap-3">
      <div className={SIMPLE_CARD}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={regionId}
          onClick={onToggle}
          className="group flex min-h-12 w-full cursor-pointer flex-wrap items-center gap-x-5 gap-y-2 px-3.5 py-2.5 text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus"
        >
          <span className="flex min-w-[min(100%,15rem)] flex-1 flex-col gap-0.5">
            <span className="text-[13px] leading-[18px] tracking-[-0.08px] text-ink">{title}</span>
            {subtitle && <span className="text-[13px] leading-[18px] tracking-[-0.08px] text-ink-secondary">{subtitle}</span>}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-3">
            {trailing}
            <ChevronRight size={14} aria-hidden="true" className={cn("text-ink-secondary transition-transform motion-reduce:transition-none", open && "rotate-90")} />
          </span>
        </button>
      </div>
      <div id={regionId} hidden={!open} className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

export function CommandLine({ command, copyLabel = "Copy command" }: { command: string; copyLabel?: string }) {
  const { state, copy } = useCopyFeedback(command);

  return (
    <div className="flex items-center gap-2 rounded-lg bg-inset px-3 py-2">
      <code className="min-w-0 flex-1 select-all overflow-x-auto whitespace-nowrap font-mono text-[12px] text-ink">
        {command}
      </code>
      <button
        type="button"
        onClick={copy}
        aria-label={state === "failed" ? t("common.copyFailed") : copyLabel}
        className="ui-icon-button shrink-0"
      >
        {state === "copied" ? <Check size={13} className="text-success" /> : state === "failed" ? <X size={13} className="text-danger" /> : <Copy size={13} />}
      </button>
    </div>
  );
}
