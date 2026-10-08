/**
 * Coquille de l'application : sidebar, topbar, contenu.
 *
 * Le mobile n'est pas un desktop réduit : la sidebar devient une barre de
 * navigation basse, qui ne garde que les destinations réellement utiles au
 * doigt.
 */

import { useState, type ReactNode } from "react";
import {
  Bell,
  Boxes,
  CreditCard,
  Films,
  FolderOpen,
  Image,
  LayoutGrid,
  Receipt,
  Settings,
  Sparkles,
  Wand2,
} from "./icons.js";
import "./AppShell.css";

export interface NavEntry {
  readonly id: string;
  readonly label: string;
  readonly icon: ReactNode;
  /** Visible dans la navigation basse du mobile. */
  readonly onMobile?: boolean;
}

const PRINCIPAL: NavEntry[] = [
  { id: "dashboard", label: "Dashboard", icon: <LayoutGrid />, onMobile: true },
  { id: "create", label: "Create", icon: <Wand2 />, onMobile: true },
  { id: "projects", label: "Projects", icon: <FolderOpen />, onMobile: true },
  { id: "generations", label: "Generations", icon: <Films />, onMobile: true },
  { id: "assets", label: "Assets", icon: <Image /> },
  { id: "templates", label: "Templates", icon: <Boxes /> },
];

const COMPTE: NavEntry[] = [
  { id: "credits", label: "Credits", icon: <CreditCard />, onMobile: true },
  { id: "billing", label: "Billing", icon: <Receipt /> },
];

const REGLAGES: NavEntry[] = [{ id: "settings", label: "Settings", icon: <Settings /> }];

export interface AppShellProps {
  readonly current: string;
  readonly onNavigate: (id: string) => void;
  readonly credits: number;
  readonly userName: string;
  readonly children: ReactNode;
}

export function AppShell({
  current,
  onNavigate,
  credits,
  userName,
  children,
}: AppShellProps) {
  const [notifOuvert, setNotifOuvert] = useState(false);
  const titreCourant =
    [...PRINCIPAL, ...COMPTE, ...REGLAGES].find((e) => e.id === current)?.label ??
    "Dashboard";

  return (
    <div className="shell">
      <a className="sr-only" href="#main">
        Aller au contenu
      </a>

      <aside className="sidebar" aria-label="Navigation principale">
        <div className="sidebar__brand">
          <AuryaMark />
          <span className="sidebar__wordmark">Aurya</span>
        </div>

        <nav className="sidebar__nav">
          <NavGroup entries={PRINCIPAL} current={current} onNavigate={onNavigate} />
          <hr className="sidebar__sep" />
          <NavGroup entries={COMPTE} current={current} onNavigate={onNavigate} />
          <hr className="sidebar__sep" />
          <NavGroup entries={REGLAGES} current={current} onNavigate={onNavigate} />
        </nav>
      </aside>

      <div className="shell__col">
        <header className="topbar">
          <p className="topbar__crumb">
            <span className="topbar__crumb-root">Aurya</span>
            <span aria-hidden="true">/</span>
            <span>{titreCourant}</span>
          </p>

          <div className="topbar__right">
            <button
              type="button"
              className="topbar__credits"
              onClick={() => onNavigate("credits")}
            >
              <Sparkles />
              <span>
                {credits} <span className="topbar__credits-unit">credits</span>
              </span>
            </button>

            <button
              type="button"
              className="topbar__icon-btn"
              aria-label="Notifications"
              aria-expanded={notifOuvert}
              onClick={() => setNotifOuvert((v) => !v)}
            >
              <Bell />
            </button>

            <button type="button" className="topbar__avatar" aria-label={`Compte de ${userName}`}>
              {userName.slice(0, 1).toUpperCase()}
            </button>
          </div>
        </header>

        <main className="main" id="main">
          {children}
        </main>
      </div>

      {/* Mobile : navigation basse, pas une sidebar rétrécie. */}
      <nav className="bottombar" aria-label="Navigation">
        {[...PRINCIPAL, ...COMPTE]
          .filter((e) => e.onMobile)
          .map((e) => (
            <button
              key={e.id}
              type="button"
              className={`bottombar__item${current === e.id ? " is-active" : ""}`}
              aria-current={current === e.id ? "page" : undefined}
              onClick={() => onNavigate(e.id)}
            >
              <span aria-hidden="true">{e.icon}</span>
              <span className="bottombar__label">{e.label}</span>
            </button>
          ))}
      </nav>
    </div>
  );
}

function NavGroup({
  entries,
  current,
  onNavigate,
}: {
  entries: NavEntry[];
  current: string;
  onNavigate: (id: string) => void;
}) {
  return (
    <ul className="navlist">
      {entries.map((e) => (
        <li key={e.id}>
          <button
            type="button"
            className={`navlink${current === e.id ? " is-active" : ""}`}
            aria-current={current === e.id ? "page" : undefined}
            onClick={() => onNavigate(e.id)}
          >
            <span className="navlink__icon" aria-hidden="true">
              {e.icon}
            </span>
            {e.label}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Le symbole Aurya, en monochrome. Pas d'ombre, pas de contour, pas de 3D. */
export function AuryaMark() {
  return (
    <svg
      className="aurya-mark"
      viewBox="0 0 1000 1000"
      role="img"
      aria-label="Aurya"
      focusable="false"
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M475.3 144.1 480.2 135.3 490.1 123.5 500 119.6 509.9 123.5 519.8 135.3 524.7 144.1 870.3 830.9 877 848.6 877.3 862.3 871.2 872.1 858.8 878 840 880 720 880 699.1 878.1 680.3 872.4 663.7 862.9 649.3 849.7 637.1 832.6 527.9 647.4 516.8 632.2 505.6 624.6 500 623.7 494.4 624.6 483.2 632.2 472.1 647.4 362.9 832.6 350.7 849.7 336.3 862.9 319.7 872.4 300.9 878.1 280 880 160 880 141.2 878 128.8 872.1 122.7 862.3 123 848.6 129.7 830.9Z M426.6 476.7 423.5 485.1 423.3 491.6 426.2 496.3 432.1 499.1 441 500 559 500 567.9 499.1 573.8 496.3 576.7 491.6 576.5 485.1 573.4 476.7 511.6 353.3 507 345.8 502.3 342.1 500 341.6 497.7 342.1 493 345.8 488.4 353.3Z"
      />
    </svg>
  );
}
