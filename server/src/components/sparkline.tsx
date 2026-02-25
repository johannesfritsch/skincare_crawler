/** Tiny SVG sparkline — no axes, no labels, just the line + filled area. */
export function Sparkline({
  data,
  width = 80,
  height = 28,
  className,
}: {
  /** Price values in chronological order (oldest → newest). */
  data: number[]
  width?: number
  height?: number
  className?: string
}) {
  if (data.length < 2) return null

  const pad = 1
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1

  const points = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (width - pad * 2)
    const y = pad + (1 - (v - min) / range) * (height - pad * 2)
    return { x, y }
  })

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const area = `${line} L${points[points.length - 1].x.toFixed(1)},${height} L${points[0].x.toFixed(1)},${height} Z`

  const last = data[data.length - 1]
  const first = data[0]
  const stroke = last <= first ? '#10b981' : '#ef4444' // green if same or dropped, red if rose

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={className}
      aria-hidden
    >
      <path d={area} fill={stroke} fillOpacity={0.1} />
      <path d={line} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
