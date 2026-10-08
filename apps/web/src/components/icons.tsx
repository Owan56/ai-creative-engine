/**
 * Icônes Lucide, redessinées en composants pour éviter une dépendance de plus.
 * Contour, 2 px, minimal. Jamais de 3D, jamais d'emoji.
 */

import type { SVGProps } from "react";

function Icon({ children, ...rest }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const LayoutGrid = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
  </Icon>
);

export const Wand2 = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="m3 21 9-9" />
    <path d="M15 4V2M15 10V8M12.5 6h-2M19.5 6h-2M17 9l1.5 1.5M17 3l1.5-1.5M13 9l-1.5 1.5M13 3l-1.5-1.5" />
  </Icon>
);

export const FolderOpen = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M2 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v1" />
    <path d="m3 19 2.4-7.2A1 1 0 0 1 6.3 11h14.4a1 1 0 0 1 .95 1.3L19.5 19a1 1 0 0 1-.95.7H4a1 1 0 0 1-.95-.7z" />
  </Icon>
);

export const Films = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 9h18M3 15h18M8 4v16M16 4v16" />
  </Icon>
);

export const Image = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="9" cy="9" r="1.6" />
    <path d="m21 15-4.5-4.5L5 21" />
  </Icon>
);

export const Boxes = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="3" y="3" width="8" height="8" rx="1.5" />
    <rect x="13" y="3" width="8" height="8" rx="1.5" />
    <rect x="3" y="13" width="8" height="8" rx="1.5" />
    <rect x="13" y="13" width="8" height="8" rx="1.5" />
  </Icon>
);

export const CreditCard = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="2" y="5" width="20" height="14" rx="2" />
    <path d="M2 10h20" />
  </Icon>
);

export const Receipt = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M5 3v18l2.5-1.5L10 21l2.5-1.5L15 21l2.5-1.5L20 21V3z" />
    <path d="M9 8h6M9 12h6" />
  </Icon>
);

export const Settings = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
  </Icon>
);

export const Bell = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.7 21a2 2 0 0 1-3.4 0" />
  </Icon>
);

export const Sparkles = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M12 3v4M12 17v4M5 12H1M23 12h-4" />
    <path d="M12 7.5 13.6 10.4 16.5 12 13.6 13.6 12 16.5 10.4 13.6 7.5 12 10.4 10.4z" />
  </Icon>
);

export const Plus = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const ArrowRight = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
);

export const Download = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M12 3v12M7 11l5 5 5-5" />
    <path d="M4 19h16" />
  </Icon>
);
