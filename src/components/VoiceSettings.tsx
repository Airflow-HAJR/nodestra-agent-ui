import { strings } from '../lib/i18n'
import {
  VOICE_SPEED_MIN, VOICE_SPEED_MAX, VOICE_SPEED_STEP, VOICE_SPEED_DEFAULT,
  VOICE_EXPRESSIVENESS_MIN, VOICE_EXPRESSIVENESS_MAX, VOICE_EXPRESSIVENESS_STEP,
  VOICE_EXPRESSIVENESS_DEFAULT,
} from '../lib/constants'
import type { VoiceSettings as VoiceSettingsValue } from '../lib/types'

interface Props {
  value: VoiceSettingsValue
  uiLang: string
  onChange: (next: VoiceSettingsValue) => void
}

interface SliderProps {
  label: string
  minLabel: string
  maxLabel: string
  readout: string
  value: number
  min: number
  max: number
  step: number
  onChange: (n: number) => void
}

/** One labelled slider with its ends named. The ends matter more than the
 *  number: "Slower / Faster" is what tells someone which way to drag, and the
 *  readout is there to confirm what they did, not to be aimed at. */
function Slider({ label, minLabel, maxLabel, readout, value, min, max, step, onChange }: SliderProps) {
  return (
    <div className="voice-slider">
      <div className="voice-slider__head">
        <span className="voice-slider__label">{label}</span>
        <span className="voice-slider__readout">{readout}</span>
      </div>
      <input
        className="voice-slider__input"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        aria-valuetext={readout}
        onChange={e => onChange(Number(e.target.value))}
      />
      <div className="voice-slider__ends">
        <span>{minLabel}</span>
        <span>{maxLabel}</span>
      </div>
    </div>
  )
}

/**
 * How the guide sounds, in the two ways that are actually audible.
 *
 * Speed earns its place in an airport: the pace that reads fine at a quiet gate
 * is too fast when you're being talked at over a boarding announcement, and a
 * non-native speaker following directions in their second language often wants
 * it slower still. Expressiveness is the difference between a level readout and
 * a guide that sounds like it means it.
 *
 * Both are sent to the server, which clamps them and applies them to the next
 * thing spoken — the sliders never touch audio that's already playing.
 */
export function VoiceSettings({ value, uiLang, onChange }: Props) {
  const S = strings(uiLang)
  const isDefault =
    Math.abs(value.speed - VOICE_SPEED_DEFAULT) < 1e-6 &&
    Math.abs(value.expressiveness - VOICE_EXPRESSIVENESS_DEFAULT) < 1e-6

  return (
    <div className="voice-settings">
      <div className="account-section-title">{S.voice}</div>

      <Slider
        label={S.voiceSpeed}
        minLabel={S.voiceSlower}
        maxLabel={S.voiceFaster}
        // One decimal and an x: "0.85x" is a ratio anyone reads at a glance,
        // where a percentage invites the question "percent of what".
        readout={`${value.speed.toFixed(2).replace(/0$/, '')}x`}
        value={value.speed}
        min={VOICE_SPEED_MIN}
        max={VOICE_SPEED_MAX}
        step={VOICE_SPEED_STEP}
        onChange={speed => onChange({ ...value, speed })}
      />

      <Slider
        label={S.voiceExpressiveness}
        minLabel={S.voiceEven}
        maxLabel={S.voiceLively}
        readout={`${Math.round(value.expressiveness * 100)}%`}
        value={value.expressiveness}
        min={VOICE_EXPRESSIVENESS_MIN}
        max={VOICE_EXPRESSIVENESS_MAX}
        step={VOICE_EXPRESSIVENESS_STEP}
        onChange={expressiveness => onChange({ ...value, expressiveness })}
      />

      {/* Hidden at the default rather than disabled: a permanently greyed-out
          button is furniture, and there is nothing to reset until something
          has been moved. */}
      {!isDefault && (
        <button
          className="voice-reset-btn"
          onClick={() => onChange({
            speed: VOICE_SPEED_DEFAULT,
            expressiveness: VOICE_EXPRESSIVENESS_DEFAULT,
          })}
        >
          {S.voiceReset}
        </button>
      )}
    </div>
  )
}
