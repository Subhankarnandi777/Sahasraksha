import { useId } from "react";

// Generate smooth cubic Bézier spline control points
function bezierPath(points) {
  if (points.length <= 1) return "";
  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? 0 : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;

    const tension = 0.22;
    const cp1x = p1.x + (p2.x - p0.x) * tension;
    const cp1y = p1.y + (p2.y - p0.y) * tension;
    const cp2x = p2.x - (p3.x - p1.x) * tension;
    const cp2y = p2.y - (p3.y - p1.y) * tension;

    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

export default function Sparkline({
  values = [],
  // Optional second series drawn dashed behind the main one, on the SAME
  // scale. Added so the S2 heartbeat chart can show the station's measured
  // signal against its fitted harmonic -- its legend used to name two
  // traces while this component could only ever draw one.
  comparison = [],
  tone = "orange", // 'orange' | 'blue' | 'amber' | 'red'
  height = 80,
  showArea = true,
  showGrid = true,
  showLabels = false
}) {
  const gradientId = useId();
  const cleanValues = values.filter((v) => Number.isFinite(Number(v))).map(Number);
  const cleanComparison = comparison.filter((v) => Number.isFinite(Number(v))).map(Number);
  const width = 320;
  const padTop = 10;
  const padBottom = 10;
  const chartHeight = height - padTop - padBottom;

  if (cleanValues.length < 2) {
    return (
      <div className="sparkline-empty" style={{ height }}>
        <span className="empty-spark-label">Awaiting telemetry frames...</span>
      </div>
    );
  }

  // Both series share one scale, otherwise a visual "comparison" of two
  // independently normalised lines would be meaningless.
  const hasComparison = cleanComparison.length >= 2;
  const scalePool = hasComparison ? [...cleanValues, ...cleanComparison] : cleanValues;
  const min = Math.min(...scalePool);
  const max = Math.max(...scalePool);
  const span = max - min || 1;
  const step = width / (cleanValues.length - 1);

  const points = cleanValues.map((val, idx) => ({
    x: idx * step,
    y: padTop + chartHeight - ((val - min) / span) * chartHeight
  }));

  const comparisonStep = hasComparison ? width / (cleanComparison.length - 1) : 0;
  const comparisonPoints = cleanComparison.map((val, idx) => ({
    x: idx * comparisonStep,
    y: padTop + chartHeight - ((val - min) / span) * chartHeight
  }));

  const splineD = bezierPath(points);
  const comparisonD = hasComparison ? bezierPath(comparisonPoints) : "";
  const lastPoint = points[points.length - 1];
  const areaD = `${splineD} L ${width} ${height} L 0 ${height} Z`;

  // Color mappings for warm theme
  const strokeColor = tone === "red" ? "#dc2626" : tone === "amber" ? "#f59e0b" : "#ea580c";
  const glowColor = tone === "red" ? "rgba(220, 38, 38, 0.25)" : "rgba(234, 88, 12, 0.25)";

  return (
    <div className="professional-chart-wrap" style={{ height }}>
      <svg
        className={`pro-sparkline ${tone}`}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={`grad-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={strokeColor} stopOpacity="0.28" />
            <stop offset="65%" stopColor={strokeColor} stopOpacity="0.06" />
            <stop offset="100%" stopColor={strokeColor} stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Subtle Horizontal Reference Gridlines */}
        {showGrid && (
          <g className="chart-gridlines" opacity="0.6">
            <line x1="0" y1={padTop} x2={width} y2={padTop} stroke="#e7e5e4" strokeDasharray="3 3" strokeWidth="1" />
            <line x1="0" y1={padTop + chartHeight * 0.5} x2={width} y2={padTop + chartHeight * 0.5} stroke="#e7e5e4" strokeDasharray="3 3" strokeWidth="1" />
            <line x1="0" y1={padTop + chartHeight} x2={width} y2={padTop + chartHeight} stroke="#e7e5e4" strokeDasharray="3 3" strokeWidth="1" />
          </g>
        )}

        {/* Translucent Gradient Area Fill */}
        {showArea && <path d={areaD} fill={`url(#grad-${gradientId})`} />}

        {/* Optional comparison series -- dashed, behind the main trace */}
        {hasComparison && (
          <path
            d={comparisonD}
            fill="none"
            stroke="#64748b"
            strokeWidth="2"
            strokeDasharray="5 4"
            strokeLinecap="round"
            opacity="0.85"
            vectorEffect="non-scaling-stroke"
          />
        )}

        {/* Ambient Soft Blur Shadow Stroke */}
        <path
          d={splineD}
          fill="none"
          stroke={strokeColor}
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.18"
          vectorEffect="non-scaling-stroke"
        />

        {/* Crisp Sharp Foreground Line */}
        <path
          d={splineD}
          fill="none"
          stroke={strokeColor}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />

        {/* Live Latest-Point Pulse Marker */}
        {lastPoint && (
          <g className="chart-latest-pulse" transform={`translate(${lastPoint.x}, ${lastPoint.y})`}>
            <circle r="6" fill={glowColor} className="ping-circle" />
            <circle r="3.5" fill={strokeColor} stroke="#ffffff" strokeWidth="1.5" />
          </g>
        )}
      </svg>

      {/* Edge Value Boundary Badges */}
      {showLabels && (
        <div className="chart-edge-labels">
          <span className="chart-min-val">Min: {min.toFixed(1)}</span>
          <span className="chart-max-val">Max: {max.toFixed(1)}</span>
        </div>
      )}
    </div>
  );
}
