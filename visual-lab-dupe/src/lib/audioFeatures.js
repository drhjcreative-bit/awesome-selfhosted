// Audio analysis + beat detection extracted from the render loop so the signal
// math can be unit-tested with synthetic frequency data instead of a live
// AnalyserNode. Pure function: it reads the previous frame's beat state and
// returns the next state alongside the derived features, rather than mutating.

/**
 * Derive per-frame visual features from a frequency spectrum.
 *
 * @param {Uint8Array|number[]} freqData Byte frequency data (each bin 0..255).
 * @param {object} opts
 * @param {number} opts.bufferLength Number of bins to read from freqData.
 * @param {number} opts.bassBins     How many low bins count as "bass".
 * @param {number} opts.bassAvg      Running bass-energy average (prev frame).
 * @param {number} opts.pulse        Decaying beat pulse (prev frame).
 * @param {boolean} opts.beat        Whether the beat pulse is enabled.
 * @param {number} opts.intensity    User intensity control, 0..1.
 * @returns {{
 *   level: number, centroid: number, bass: number,
 *   pulse: number, bassAvg: number,
 *   beatBoost: number, intensityFactor: number,
 * }}
 */
export const computeAudioFeatures = (
  freqData,
  { bufferLength, bassBins, bassAvg, pulse, beat, intensity },
) => {
  let sum = 0;
  let bassSum = 0;
  let weighted = 0;
  for (let i = 0; i < bufferLength; i++) {
    const v = freqData[i];
    sum += v;
    weighted += v * i;
    if (i < bassBins) bassSum += v;
  }
  const level = sum / bufferLength / 255; // mean magnitude, 0..1
  const centroid = weighted / (sum || 1);

  // Beat detection on bass energy, feeding a decaying pulse. A strong spike
  // above the running average registers a beat; the pulse then decays each
  // frame and the average tracks the signal slowly.
  const bass = bassSum / bassBins / 255;
  let nextPulse = pulse;
  if (bass > bassAvg * 1.35 && bass > 0.12) nextPulse = 1;
  nextPulse *= 0.9;
  const nextBassAvg = bassAvg * 0.92 + bass * 0.08;
  const beatBoost = beat ? nextPulse * 0.6 : 0;

  const intensityFactor = 0.4 + intensity * 1.2 + beatBoost;

  return {
    level,
    centroid,
    bass,
    pulse: nextPulse,
    bassAvg: nextBassAvg,
    beatBoost,
    intensityFactor,
  };
};
