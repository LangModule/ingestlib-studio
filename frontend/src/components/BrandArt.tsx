/* The cover artwork retold as an inline SVG: a document with glowing region
   outlines dissolves into pages, then wireframe cubes, then a drift of
   particles. It sits fixed in the bottom-right corner behind the content and
   is purely decorative. */

const MINT = "#5fd4b4";
const AMBER = "#e5b76a";
const INK = "#e8ebf0";

interface CubeProps {
  x: number;
  y: number;
  r: number;
  color: string;
  opacity: number;
}

function Cube({ x, y, r, color, opacity }: CubeProps) {
  const top = `${x},${y - r} ${x + r},${y - r / 2} ${x},${y} ${x - r},${y - r / 2}`;
  const left = `${x - r},${y - r / 2} ${x},${y} ${x},${y + r} ${x - r},${y + r / 2}`;
  const right = `${x + r},${y - r / 2} ${x},${y} ${x},${y + r} ${x + r},${y + r / 2}`;
  return (
    <g stroke={color} strokeOpacity={opacity} fill={color} fillOpacity={opacity * 0.12}>
      <polygon points={top} />
      <polygon points={left} />
      <polygon points={right} />
    </g>
  );
}

const CUBES: CubeProps[] = [
  { x: 330, y: 236, r: 17, color: AMBER, opacity: 0.85 },
  { x: 368, y: 218, r: 14, color: MINT, opacity: 0.75 },
  { x: 398, y: 240, r: 11, color: MINT, opacity: 0.6 },
  { x: 424, y: 205, r: 10, color: AMBER, opacity: 0.6 },
  { x: 448, y: 226, r: 8, color: MINT, opacity: 0.5 },
  { x: 468, y: 196, r: 7, color: AMBER, opacity: 0.45 },
  { x: 488, y: 214, r: 5, color: MINT, opacity: 0.4 },
];

// Each entry is cx, cy, radius, color, opacity: the drift the cubes become.
const PARTICLES: [number, number, number, string, number][] = [
  [500, 180, 2.5, MINT, 0.8], [516, 196, 1.8, AMBER, 0.7], [524, 168, 2.2, MINT, 0.6],
  [538, 186, 1.5, INK, 0.5], [546, 158, 2.0, MINT, 0.55], [556, 176, 1.4, AMBER, 0.5],
  [566, 148, 1.8, MINT, 0.5], [574, 190, 1.2, INK, 0.4], [582, 164, 1.6, AMBER, 0.45],
  [590, 140, 1.3, MINT, 0.4], [598, 178, 1.0, INK, 0.35], [604, 154, 1.4, MINT, 0.35],
  [612, 130, 1.1, AMBER, 0.3], [618, 168, 0.9, MINT, 0.3], [528, 210, 1.4, MINT, 0.45],
  [548, 222, 1.1, AMBER, 0.4], [568, 208, 1.0, MINT, 0.35], [586, 216, 0.8, INK, 0.3],
  [510, 148, 1.6, AMBER, 0.5], [534, 136, 1.2, MINT, 0.4], [558, 124, 1.0, AMBER, 0.35],
  [580, 112, 0.9, MINT, 0.3], [600, 100, 0.8, INK, 0.25], [614, 116, 0.7, MINT, 0.25],
];

export function BrandArt() {
  return (
    <svg
      aria-hidden
      className="pointer-events-none fixed -right-16 -bottom-14 -z-10 hidden w-[480px] max-w-[50vw] select-none opacity-60 md:block xl:w-[560px]"
      viewBox="0 0 640 400"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <filter id="brand-glow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="10" />
        </filter>
      </defs>

      {/* Soft light behind the transformation. */}
      <circle cx="360" cy="220" r="80" fill={MINT} opacity="0.06" filter="url(#brand-glow)" />
      <circle cx="540" cy="160" r="70" fill={AMBER} opacity="0.05" filter="url(#brand-glow)" />

      {/* The source document, tilted like the cover. */}
      <g transform="rotate(-8 150 240)">
        <rect
          x="64" y="110" width="164" height="216" rx="6"
          fill={INK} fillOpacity="0.06" stroke={INK} strokeOpacity="0.35"
        />
        {/* Title region, outlined mint. */}
        <rect x="82" y="130" width="128" height="36" rx="3" stroke={MINT} strokeOpacity="0.8" />
        <line x1="92" y1="143" x2="186" y2="143" stroke={INK} strokeOpacity="0.5" strokeWidth="3" />
        <line x1="92" y1="153" x2="164" y2="153" stroke={INK} strokeOpacity="0.3" strokeWidth="3" />
        {/* Table region, outlined amber. */}
        <rect x="82" y="180" width="128" height="54" rx="3" stroke={AMBER} strokeOpacity="0.8" />
        <line x1="82" y1="198" x2="210" y2="198" stroke={AMBER} strokeOpacity="0.4" />
        <line x1="82" y1="216" x2="210" y2="216" stroke={AMBER} strokeOpacity="0.4" />
        <line x1="125" y1="180" x2="125" y2="234" stroke={AMBER} strokeOpacity="0.4" />
        <line x1="168" y1="180" x2="168" y2="234" stroke={AMBER} strokeOpacity="0.4" />
        {/* Chart region with mint bars. */}
        <rect x="82" y="248" width="128" height="60" rx="3" stroke={AMBER} strokeOpacity="0.6" />
        {[0, 1, 2, 3, 4].map((i) => (
          <rect
            key={i}
            x={94 + i * 22} y={298 - (i % 3) * 12 - i * 4}
            width="10" height={10 + (i % 3) * 12 + i * 4}
            fill={MINT} fillOpacity="0.55"
          />
        ))}
      </g>

      {/* Pages peeling away toward the cubes. */}
      <g transform="rotate(-6 280 220)">
        <rect x="240" y="150" width="64" height="86" rx="4" fill={INK} fillOpacity="0.08" stroke={INK} strokeOpacity="0.3" />
        <line x1="250" y1="168" x2="294" y2="168" stroke={INK} strokeOpacity="0.4" strokeWidth="2.5" />
        <line x1="250" y1="180" x2="286" y2="180" stroke={INK} strokeOpacity="0.3" strokeWidth="2.5" />
        <line x1="250" y1="192" x2="292" y2="192" stroke={INK} strokeOpacity="0.25" strokeWidth="2.5" />
      </g>
      <g transform="rotate(-3 320 210)">
        <rect x="292" y="140" width="48" height="64" rx="4" fill={INK} fillOpacity="0.06" stroke={INK} strokeOpacity="0.22" />
        <line x1="300" y1="154" x2="332" y2="154" stroke={INK} strokeOpacity="0.3" strokeWidth="2" />
        <line x1="300" y1="164" x2="326" y2="164" stroke={INK} strokeOpacity="0.22" strokeWidth="2" />
      </g>

      {/* Chunks as wireframe cubes, then particles. */}
      {CUBES.map((cube) => (
        <Cube key={`${cube.x}-${cube.y}`} {...cube} />
      ))}
      <g className="particle-drift">
        {PARTICLES.filter((_, index) => index % 2 === 0).map(([cx, cy, r, color, opacity], index) => (
          <circle key={index} cx={cx} cy={cy} r={r} fill={color} fillOpacity={opacity} />
        ))}
      </g>
      <g className="particle-drift-slow">
        {PARTICLES.filter((_, index) => index % 2 === 1).map(([cx, cy, r, color, opacity], index) => (
          <circle key={index} cx={cx} cy={cy} r={r} fill={color} fillOpacity={opacity} />
        ))}
      </g>
    </svg>
  );
}
