/** Area sparkline from home-v3. Points are scaled into a 300x90 box. */
export function Sparkline({ series }: { series: number[] }) {
  const max = Math.max(...series, 1);
  const step = series.length > 1 ? 300 / (series.length - 1) : 300;
  const pts = series.map((v, i) => [Math.round(i * step), Math.round(90 - (v / max) * 82)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg className="spark" viewBox="0 0 300 90" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="spark-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#cddbc6" />
          <stop offset="1" stopColor="#cddbc6" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L300 90 L0 90Z`} fill="url(#spark-fill)" />
      <path d={line} fill="none" stroke="#5f8a66" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r="4" fill="#1f4d3a" />
    </svg>
  );
}
