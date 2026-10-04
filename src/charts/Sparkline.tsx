export function Sparkline({ values, index, width = 60, height = 16 }: { values: number[]; index: number; width?: number; height?: number }) {
  if (values.length < 2) return <svg width={width} height={height} aria-hidden="true" />;
  const max = Math.max(...values, 1e-6);
  const min = Math.min(0, ...values);
  const x = (i: number) => (i / (values.length - 1)) * (width - 2) + 1;
  const y = (v: number) => height - 2 - ((v - min) / (max - min || 1)) * (height - 4);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  return (
    <svg width={width} height={height} className="spark" aria-hidden="true">
      <path d={d} className="spark__line" />
      {index >= 0 && <circle cx={x(index)} cy={y(values[index])} r={2.2} className="spark__dot" />}
    </svg>
  );
}
