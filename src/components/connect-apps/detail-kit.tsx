import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/cn";
import "./connect-apps.css";

/** The parts of Grok's app page body, under an app's name and what it does: 13px guide text, numbered steps, a labelled
 * field, 32px pill buttons, small underlined links, status lines and the bordered cards of rows. */
export function KitBody({ children, className, ...rest }: HTMLAttributes<HTMLElement>) {
  return <section className={cn("ca-kit", className)} {...rest}>{children}</section>;
}

export function KitText({ children, tone }: { children: ReactNode; tone?: "danger" | "warning" }) {
  return <span className="ca-kit-text" data-tone={tone} role={tone ? "alert" : undefined}>{children}</span>;
}

export function KitSteps({ steps }: { steps: ReactNode[] }) {
  return (
    <ol className="ca-kit-steps">
      {steps.map((step, index) => <li key={index}><span aria-hidden="true">{index + 1}</span><span>{step}</span></li>)}
    </ol>
  );
}

export function KitField({ label, ...input }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="ca-kit-field">
      <span>{label}</span>
      <input aria-label={label} {...input} />
    </label>
  );
}

export function KitActions({ children }: { children: ReactNode }) {
  return <span className="ca-kit-actions">{children}</span>;
}

export function KitButton({ variant = "primary", tone, className, ...button }: { variant?: "primary" | "secondary"; tone?: "danger" } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...button} className={cn("ca-kit-button", className)} data-variant={variant} data-tone={tone} />;
}

export function KitLink({ className, ...button }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...button} className={cn("ca-kit-link", className)} />;
}

export function KitStatus({ children, tone = "quiet" }: { children: ReactNode; tone?: "quiet" | "ok" | "warning" | "danger" }) {
  return <span className="ca-kit-status" data-tone={tone} role={tone === "danger" || tone === "warning" ? "alert" : "status"}>{children}</span>;
}

export function KitCard({ label, count, children }: { label: string; count?: number; children: ReactNode }) {
  return (
    <div className="ca-kit-card">
      <h3 className="ca-group-label">{label}{count !== undefined && <span>{count}</span>}</h3>
      <div className="ca-card">{children}</div>
    </div>
  );
}

export function KitRow({ title, detail, children }: { title: ReactNode; detail?: ReactNode; children?: ReactNode }) {
  return (
    <div className="ca-card-row">
      <span>{title}{detail && <small>{detail}</small>}</span>
      {children}
    </div>
  );
}
