import React from 'react';

/**
 * Illustrations vectorielles discrètes (vert émeraude sur fond sombre).
 * - PanelIllustration : remplace les anciennes photos de bandeau.
 * - BottomArt : décor très léger en bas de page, derrière le contenu.
 */

export type IllustrationVariant =
  | 'login'
  | 'network'
  | 'workspace'
  | 'training'
  | 'audit'
  | 'mobile'
  | 'subscription';

const STROKE = 'stroke-emerald-400';

const Backdrop: React.FC = () => {
  const uid = React.useId().replace(/:/g, '');
  return (
  <>
    <defs>
      <radialGradient id={`pa-glow-${uid}`} cx="50%" cy="45%" r="65%">
        <stop offset="0%" stopColor="#10b981" stopOpacity="0.18" />
        <stop offset="100%" stopColor="#020617" stopOpacity="0" />
      </radialGradient>
      <pattern id={`pa-grid-${uid}`} width="24" height="24" patternUnits="userSpaceOnUse">
        <path d="M24 0H0V24" fill="none" stroke="#94a3b8" strokeOpacity="0.07" strokeWidth="1" />
      </pattern>
    </defs>
    <rect width="400" height="300" fill="#020617" />
    <rect width="400" height="300" fill={`url(#pa-grid-${uid})`} />
    <rect width="400" height="300" fill={`url(#pa-glow-${uid})`} />
  </>
  );
};

const Cross: React.FC<{ x: number; y: number; s?: number; filled?: boolean }> = ({
  x,
  y,
  s = 14,
  filled = false,
}) => {
  const a = s / 3;
  const d = `M${x - a / 2} ${y - s / 2}h${a}v${(s - a) / 2}h${(s - a) / 2}v${a}h-${(s - a) / 2}v${(s - a) / 2}h-${a}v-${(s - a) / 2}h-${(s - a) / 2}v-${a}h${(s - a) / 2}z`;
  return filled ? (
    <path d={d} className="fill-emerald-500" />
  ) : (
    <path d={d} className={STROKE} fill="none" strokeWidth="1.5" strokeLinejoin="round" />
  );
};

const Pill: React.FC<{ x: number; y: number; r?: number; o?: number }> = ({ x, y, r = 0, o = 0.7 }) => (
  <g transform={`translate(${x} ${y}) rotate(${r})`} opacity={o}>
    <rect x="-14" y="-6" width="28" height="12" rx="6" className={STROKE} fill="none" strokeWidth="1.5" />
    <path d="M0 -6V6" className={STROKE} strokeWidth="1.5" />
    <rect x="-14" y="-6" width="14" height="12" rx="6" className="fill-emerald-500/25" />
  </g>
);

const Scene: React.FC<{ variant: IllustrationVariant }> = ({ variant }) => {
  switch (variant) {
    case 'network':
      return (
        <g>
          {[
            [90, 70],
            [310, 70],
            [60, 190],
            [340, 200],
            [200, 250],
          ].map(([x, y], i) => (
            <g key={i}>
              <line x1="200" y1="140" x2={x} y2={y} className={STROKE} strokeOpacity="0.45" strokeWidth="1.2" strokeDasharray="4 4" />
              <circle cx={x} cy={y} r="17" className={STROKE} fill="#020617" strokeWidth="1.5" />
              <Cross x={x} y={y} s={12} />
            </g>
          ))}
          <circle cx="200" cy="140" r="44" className={STROKE} strokeOpacity="0.3" fill="none" strokeWidth="1" />
          <circle cx="200" cy="140" r="32" className={STROKE} fill="#020617" strokeWidth="1.8" />
          <Cross x={200} y={140} s={26} filled />
        </g>
      );
    case 'workspace':
      return (
        <g>
          <g opacity="0.95">
            <rect x="70" y="60" width="120" height="160" rx="10" className={STROKE} fill="#0b1220" strokeWidth="1.6" />
            {[90, 108, 126, 144, 162].map((y) => (
              <line key={y} x1="86" y1={y} x2={y % 36 === 0 ? 160 : 174} y2={y} stroke="#64748b" strokeWidth="3" strokeLinecap="round" opacity="0.6" />
            ))}
            <path d="M58 72V58h14M202 58h14v14M216 208v14h-14M72 222H58v-14" className={STROKE} fill="none" strokeWidth="2" strokeLinecap="round" />
          </g>
          <path d="M214 140h38m-10-10 10 10-10 10" className={STROKE} fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="262" y="84" width="76" height="112" rx="9" className={STROKE} fill="#0b1220" strokeWidth="1.6" strokeDasharray="5 4" />
          <circle cx="300" cy="126" r="16" className={STROKE} fill="none" strokeWidth="2" />
          <path d="M292 126l6 6 11-12" className={STROKE} fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          <text x="300" y="172" textAnchor="middle" fontSize="10" fontFamily="ui-monospace, monospace" className="fill-emerald-400" opacity="0.85">
            BROUILLON
          </text>
        </g>
      );
    case 'training':
      return (
        <g>
          <rect x="60" y="70" width="170" height="130" rx="8" className={STROKE} fill="#0b1220" strokeWidth="1.6" />
          {[100, 130, 160].map((y) => (
            <line key={y} x1="60" y1={y} x2="230" y2={y} stroke="#64748b" strokeOpacity="0.5" />
          ))}
          {[117, 174].map((x) => (
            <line key={x} x1={x} y1="70" x2={x} y2="200" stroke="#64748b" strokeOpacity="0.5" />
          ))}
          <rect x="60" y="70" width="170" height="30" rx="8" className="fill-emerald-500/20" />
          <g fill="none" className={STROKE} strokeWidth="1.5">
            <circle cx="300" cy="100" r="9" />
            <circle cx="340" cy="150" r="9" />
            <circle cx="290" cy="190" r="9" />
            <circle cx="300" cy="145" r="14" />
            <path d="M231 135l55 8M309 108l-5 24M311 153l20 -2M296 159l-4 22M232 175l50 14" strokeOpacity="0.6" strokeDasharray="3 3" />
          </g>
          <circle cx="300" cy="145" r="5" className="fill-emerald-500" />
        </g>
      );
    case 'audit':
      return (
        <g>
          <path d="M200 52l70 24v62c0 44-30 76-70 96-40-20-70-52-70-96V76z" className={STROKE} fill="#0b1220" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M170 142l22 22 40-46" className={STROKE} fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          {[0, 1, 2].map((i) => (
            <g key={i} opacity={0.6 - i * 0.12}>
              <circle cx="320" cy={96 + i * 36} r="3" className="fill-emerald-400" />
              <line x1="332" y1={96 + i * 36} x2={372 - i * 10} y2={96 + i * 36} stroke="#64748b" strokeWidth="3" strokeLinecap="round" />
            </g>
          ))}
          {[0, 1, 2].map((i) => (
            <g key={`l${i}`} opacity={0.6 - i * 0.12}>
              <circle cx="80" cy={96 + i * 36} r="3" className="fill-emerald-400" />
              <line x1="28" y1={96 + i * 36} x2="68" y2={96 + i * 36} stroke="#64748b" strokeWidth="3" strokeLinecap="round" />
            </g>
          ))}
        </g>
      );
    case 'mobile':
      return (
        <g>
          <rect x="60" y="70" width="190" height="124" rx="9" className={STROKE} fill="#0b1220" strokeWidth="1.6" />
          <path d="M130 194v22h50v-22M112 216h86" className={STROKE} fill="none" strokeWidth="1.6" strokeLinecap="round" />
          <Cross x={155} y={125} s={28} filled />
          <line x1="96" y1="168" x2="214" y2="168" stroke="#64748b" strokeWidth="3" strokeLinecap="round" opacity="0.6" />
          <rect x="278" y="92" width="64" height="124" rx="12" className={STROKE} fill="#0b1220" strokeWidth="1.6" />
          <line x1="300" y1="102" x2="320" y2="102" stroke="#64748b" strokeWidth="2.5" strokeLinecap="round" />
          <Cross x={310} y={150} s={20} />
          <rect x="292" y="184" width="36" height="8" rx="4" className="fill-emerald-500/30" />
        </g>
      );
    case 'subscription':
      return (
        <g>
          {[
            [80, 150, 70],
            [165, 118, 102],
            [250, 80, 140],
          ].map(([x, y, h], i) => (
            <g key={i}>
              <rect x={x} y={y} width="70" height={h} rx="9" className={STROKE} fill="#0b1220" strokeWidth="1.6" opacity={0.55 + i * 0.2} />
              <line x1={x + 14} y1={y + 20} x2={x + 56} y2={y + 20} stroke="#64748b" strokeWidth="3" strokeLinecap="round" opacity="0.7" />
              <line x1={x + 14} y1={y + 36} x2={x + 42} y2={y + 36} stroke="#64748b" strokeWidth="3" strokeLinecap="round" opacity="0.5" />
              <Cross x={x + 35} y={y + h - 22} s={14 + i * 3} filled={i === 2} />
            </g>
          ))}
        </g>
      );
    case 'login':
    default:
      return (
        <g>
          <circle cx="200" cy="140" r="104" className={STROKE} strokeOpacity="0.14" fill="none" strokeWidth="1" />
          <circle cx="200" cy="140" r="74" className={STROKE} strokeOpacity="0.25" fill="none" strokeWidth="1" strokeDasharray="3 6" />
          <rect x="150" y="90" width="100" height="100" rx="24" className={STROKE} fill="#0b1220" strokeWidth="1.8" />
          <Cross x={200} y={140} s={54} filled />
          <Pill x={90} y={80} r={-25} />
          <Pill x={318} y={92} r={30} o={0.55} />
          <Pill x={96} y={216} r={20} o={0.5} />
          <Pill x={312} y={212} r={-18} />
          <path d="M20 262h96l12-22 14 40 14-52 14 34h210" className={STROKE} fill="none" strokeWidth="1.5" strokeOpacity="0.5" strokeLinejoin="round" strokeLinecap="round" />
        </g>
      );
  }
};

interface PanelIllustrationProps {
  variant: IllustrationVariant;
  className?: string;
  label?: string;
}

export const PanelIllustration: React.FC<PanelIllustrationProps> = ({
  variant,
  className = 'h-full w-full',
  label,
}) => (
  <svg
    viewBox="0 0 400 300"
    preserveAspectRatio="xMidYMid slice"
    className={className}
    role={label ? 'img' : undefined}
    aria-label={label}
    aria-hidden={label ? undefined : true}
  >
    <Backdrop />
    <Scene variant={variant} />
  </svg>
);

/**
 * Décor de bas de page : très discret (opacité faible), derrière le contenu,
 * ne capte aucun clic. Le parent doit avoir `isolate relative`.
 */
export const BottomArt: React.FC = () => (
  <div
    aria-hidden="true"
    className="pointer-events-none fixed inset-x-0 bottom-0 -z-10 h-64 overflow-hidden opacity-[0.16] [mask-image:linear-gradient(to_top,black,transparent)]"
  >
    <svg viewBox="0 0 1440 260" preserveAspectRatio="xMidYMax slice" className="h-full w-full">
      <g fill="none" className={STROKE} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M0 215c120-30 240-30 360 0s240 30 360 0 240-30 360 0 240 30 360 0" opacity="0.7" />
        <path d="M0 238c120-24 240-24 360 0s240 24 360 0 240-24 360 0 240 24 360 0" opacity="0.4" />
        <path d="M0 180h210l22-34 28 66 26-90 24 58h250" opacity="0.5" />
        <g transform="translate(980 120)">
          <rect x="0" y="0" width="64" height="64" rx="16" />
          <path d="M26 14h12v14h14v12H38v14H26V40H12V28h14z" />
        </g>
        <g transform="translate(300 96) rotate(-24)">
          <rect x="0" y="0" width="56" height="22" rx="11" />
          <path d="M28 0v22" />
        </g>
        <g transform="translate(1200 150) rotate(18)">
          <rect x="0" y="0" width="56" height="22" rx="11" />
          <path d="M28 0v22" />
        </g>
        <circle cx="640" cy="120" r="20" />
        <circle cx="700" cy="150" r="9" />
        <circle cx="610" cy="170" r="6" />
      </g>
    </svg>
  </div>
);
