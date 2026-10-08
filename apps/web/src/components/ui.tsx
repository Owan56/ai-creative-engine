/**
 * Primitives du système de design Aurya.
 *
 * Aucune couleur en dur : tout passe par les tokens de `tokens.css`. Avant
 * d'ajouter un composant ailleurs, vérifier qu'il n'est pas déjà ici.
 */

import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import "./ui.css";

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------- Button

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "md" | "lg";
  icon?: ReactNode;
  /** Occupe toute la largeur disponible. */
  block?: boolean;
}

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  block,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className={cx("btn", `btn--${variant}`, `btn--${size}`, block && "btn--block", className)}
      {...rest}
    >
      {icon ? (
        <span className="btn__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- Card

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Grande card : rayon 18 px plutôt que 14 px. */
  large?: boolean;
  /** Légère montée au survol. Réservé aux cards cliquables. */
  interactive?: boolean;
}

export function Card({ large, interactive, className, children, ...rest }: CardProps) {
  return (
    <div
      className={cx("card", large && "card--lg", interactive && "card--interactive", className)}
      {...rest}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- Badge

export type StatusKind =
  | "ready"
  | "generating"
  | "processing"
  | "completed"
  | "failed";

const STATUS_LABEL: Record<StatusKind, string> = {
  ready: "AI ready",
  generating: "Generating",
  processing: "Processing",
  completed: "Completed",
  failed: "Failed",
};

/**
 * L'état n'est jamais porté par la seule couleur : la pastille est toujours
 * accompagnée de son libellé.
 */
export function StatusBadge({ kind }: { kind: StatusKind }) {
  return (
    <span className={cx("badge", `badge--${kind}`)}>
      <span className="badge__dot" aria-hidden="true" />
      {STATUS_LABEL[kind]}
    </span>
  );
}

// ---------------------------------------------------------------- Input

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
}

export function Field({ label, hint, id, className, ...rest }: FieldProps) {
  const inputId = id ?? `f-${label.toLowerCase().replace(/\W+/g, "-")}`;
  const hintId = hint ? `${inputId}-hint` : undefined;

  return (
    <div className={cx("field", className)}>
      <label className="field__label" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        className="field__input"
        {...(hintId ? { "aria-describedby": hintId } : {})}
        {...rest}
      />
      {hint ? (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- Progress

export function Progress({ value, label }: { value: number; label: string }) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div
      className="progress"
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <span className="progress__fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

// ---------------------------------------------------------------- EmptyState

export function EmptyState({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <h3 className="empty__title">{title}</h3>
      <p className="empty__text">{text}</p>
      {action ? <div className="empty__action">{action}</div> : null}
    </div>
  );
}
