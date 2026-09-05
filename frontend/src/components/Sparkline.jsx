function pathFrom(values, width, height) {
  if (!values.length) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = values.length > 1 ? width / (values.length - 1) : width;

  return values.map((value, index) => {
    const x = index * step;
    const y = height - ((value - min) / span) * height;
    return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
}

export default function Sparkline({ values = [], tone = "blue", height = 70 }) {
  const cleanValues = values.filter((value) => Number.isFinite(Number(value))).map(Number);
  const width = 260;

  return (
    <svg className={`sparkline ${tone}`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <path className="sparkline-glow" d={pathFrom(cleanValues, width, height)} />
      <path d={pathFrom(cleanValues, width, height)} />
    </svg>
  );
}
