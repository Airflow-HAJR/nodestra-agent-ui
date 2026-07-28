interface WaveformVisualizerProps {
  audioLevel: number
  isActive: boolean
}

const BAR_COUNT = 13

export function WaveformVisualizer({ audioLevel, isActive }: WaveformVisualizerProps) {
  if (!isActive) return null

  return (
    <div className="waveform" aria-hidden="true" role="presentation">
      {Array.from({ length: BAR_COUNT }).map((_, i) => {
        // Each bar gets a different phase based on its index
        const center = (BAR_COUNT - 1) / 2
        const distFromCenter = Math.abs(i - center) / center
        const barLevel = Math.max(0.08, audioLevel * (1 - distFromCenter * 0.5))
        const heightPct = 20 + barLevel * 80 // 20% to 100% height
        const animDelay = (i * 60) % 360 // stagger animation

        return (
          <div
            key={i}
            className="waveform-bar"
            style={{
              height: `${heightPct}%`,
              animationDelay: `${animDelay}ms`,
              opacity: 0.5 + barLevel * 0.5,
            }}
          />
        )
      })}
    </div>
  )
}
