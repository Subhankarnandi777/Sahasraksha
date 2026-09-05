export default function MetricCard({ tone = "healthy", label, value, subtext }) {
  return (
    <article className={`metric-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{subtext}</small>
    </article>
  );
}
