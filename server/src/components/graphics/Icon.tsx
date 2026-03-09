import React from 'react'

/**
 * AnySkin icon — two overlapping brand-colored circles.
 * Circles are re-centered into a clean 100x100 square viewBox
 * so the icon renders fully within Payload's fixed-size container.
 */
export default function Icon() {
  // Original circles from logo SVG, re-centered to fit a 100×100 square:
  // Light circle: original center (150.68, 180.82) r=150.68
  // Dark circle: original center (226.03, 105.48) r=105.48
  // Combined bounding box: x 0–331.51, y 0–331.50 → ~332×332
  // Scale factor: 100/332 ≈ 0.3012
  // Scaled light: cx=45.4, cy=54.5, r=45.4
  // Scaled dark: cx=68.1, cy=31.8, r=31.8
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="-8 -8 116 116"
      style={{ width: 20, height: 20 }}
    >
      <circle fill="#ffb680" cx="45.4" cy="54.5" r="45.4" />
      <circle fill="#ff8327" cx="68.1" cy="31.8" r="31.8" />
    </svg>
  )
}
