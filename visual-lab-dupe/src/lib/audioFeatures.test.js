import { describe, it, expect } from "vitest";
import { computeAudioFeatures } from "./audioFeatures.js";

// A quiet starting beat state, mirroring the render loop's initial values.
const idle = { bassAvg: 0, pulse: 0, beat: true, intensity: 0.5 };

describe("computeAudioFeatures — spectral features", () => {
  it("reports zero level/centroid for silence without dividing by zero", () => {
    const freq = new Uint8Array(8); // all zeros
    const f = computeAudioFeatures(freq, {
      bufferLength: 8,
      bassBins: 2,
      ...idle,
    });
    expect(f.level).toBe(0);
    expect(f.centroid).toBe(0); // guarded by (sum || 1), so not NaN
    expect(f.bass).toBe(0);
  });

  it("computes level as the normalized mean magnitude (full scale -> 1)", () => {
    const freq = new Uint8Array([255, 255, 255, 255]);
    const f = computeAudioFeatures(freq, {
      bufferLength: 4,
      bassBins: 1,
      ...idle,
    });
    expect(f.level).toBeCloseTo(1, 10);
  });

  it("computes level for a partial signal", () => {
    // mean of [255,0,255,0] = 127.5 -> /255 = 0.5
    const freq = new Uint8Array([255, 0, 255, 0]);
    const f = computeAudioFeatures(freq, {
      bufferLength: 4,
      bassBins: 1,
      ...idle,
    });
    expect(f.level).toBeCloseTo(0.5, 10);
  });

  it("computes the magnitude-weighted spectral centroid (bin index)", () => {
    // weighted = 255*(0+1+2+3)=1530, sum=1020 -> 1.5
    const freq = new Uint8Array([255, 255, 255, 255]);
    const f = computeAudioFeatures(freq, {
      bufferLength: 4,
      bassBins: 1,
      ...idle,
    });
    expect(f.centroid).toBeCloseTo(1.5, 10);
  });

  it("weights the centroid toward high bins when energy sits there", () => {
    const lowHeavy = computeAudioFeatures(new Uint8Array([255, 0, 0, 0]), {
      bufferLength: 4,
      bassBins: 1,
      ...idle,
    });
    const highHeavy = computeAudioFeatures(new Uint8Array([0, 0, 0, 255]), {
      bufferLength: 4,
      bassBins: 1,
      ...idle,
    });
    expect(lowHeavy.centroid).toBeCloseTo(0, 10);
    expect(highHeavy.centroid).toBeCloseTo(3, 10);
  });

  it("only averages the first `bassBins` bins for bass energy", () => {
    // bins 0,1 loud; 2,3 silent; bassBins=2 -> bass = mean(200,200)/255
    const freq = new Uint8Array([200, 200, 0, 0]);
    const f = computeAudioFeatures(freq, {
      bufferLength: 4,
      bassBins: 2,
      ...idle,
    });
    expect(f.bass).toBeCloseTo(200 / 255, 10);
  });

  it("respects bufferLength and ignores bins beyond it", () => {
    // Extra trailing energy past bufferLength must not affect the result.
    const freq = new Uint8Array([255, 255, 255, 255]);
    const f = computeAudioFeatures(freq, {
      bufferLength: 2,
      bassBins: 1,
      ...idle,
    });
    expect(f.level).toBeCloseTo(1, 10); // mean of first 2 bins only
  });
});

describe("computeAudioFeatures — beat detection", () => {
  const bassSpike = new Uint8Array([200, 200, 0, 0]); // bass ~0.784

  it("fires a pulse when bass spikes above the running average", () => {
    const f = computeAudioFeatures(bassSpike, {
      bufferLength: 4,
      bassBins: 2,
      bassAvg: 0,
      pulse: 0,
      beat: true,
      intensity: 0.5,
    });
    // pulse is set to 1 on the beat, then immediately decayed by 0.9.
    expect(f.pulse).toBeCloseTo(0.9, 10);
  });

  it("does not fire when bass is loud but below 1.35x the average", () => {
    const f = computeAudioFeatures(bassSpike, {
      bufferLength: 4,
      bassBins: 2,
      bassAvg: 1, // 0.784 is well under 1.35 here
      pulse: 0.5,
      beat: true,
      intensity: 0.5,
    });
    expect(f.pulse).toBeCloseTo(0.45, 10); // just the decay of the prior pulse
  });

  it("does not fire on a quiet signal even above the (zero) average", () => {
    // bass ~0.098, under the absolute 0.12 floor.
    const quiet = new Uint8Array([25, 25, 0, 0]);
    const f = computeAudioFeatures(quiet, {
      bufferLength: 4,
      bassBins: 2,
      bassAvg: 0,
      pulse: 0.5,
      beat: true,
      intensity: 0.5,
    });
    expect(f.bass).toBeLessThan(0.12);
    expect(f.pulse).toBeCloseTo(0.45, 10);
  });

  it("decays the pulse by 0.9 each frame with no new beat", () => {
    const silent = new Uint8Array(4);
    const step = (pulse) =>
      computeAudioFeatures(silent, {
        bufferLength: 4,
        bassBins: 2,
        bassAvg: 0,
        pulse,
        beat: true,
        intensity: 0.5,
      }).pulse;
    let p = 1;
    p = step(p);
    expect(p).toBeCloseTo(0.9, 10);
    p = step(p);
    expect(p).toBeCloseTo(0.81, 10);
  });

  it("updates the bass average as an exponential moving average", () => {
    const f = computeAudioFeatures(bassSpike, {
      bufferLength: 4,
      bassBins: 2,
      bassAvg: 0.2,
      pulse: 0,
      beat: true,
      intensity: 0.5,
    });
    const bass = 200 / 255;
    expect(f.bassAvg).toBeCloseTo(0.2 * 0.92 + bass * 0.08, 10);
  });
});

describe("computeAudioFeatures — intensity/beat coupling", () => {
  it("adds a beat boost to intensityFactor when beat is enabled", () => {
    const f = computeAudioFeatures(new Uint8Array([200, 200, 0, 0]), {
      bufferLength: 4,
      bassBins: 2,
      bassAvg: 0,
      pulse: 0,
      beat: true,
      intensity: 0.5,
    });
    // 0.4 + 0.5*1.2 + (0.9 * 0.6)
    expect(f.beatBoost).toBeCloseTo(0.54, 10);
    expect(f.intensityFactor).toBeCloseTo(0.4 + 0.6 + 0.54, 10);
  });

  it("ignores the pulse in intensityFactor when beat is disabled", () => {
    const f = computeAudioFeatures(new Uint8Array([200, 200, 0, 0]), {
      bufferLength: 4,
      bassBins: 2,
      bassAvg: 0,
      pulse: 0,
      beat: false,
      intensity: 0.5,
    });
    expect(f.beatBoost).toBe(0);
    expect(f.intensityFactor).toBeCloseTo(0.4 + 0.6, 10);
    // The pulse state still advances even while the boost is muted.
    expect(f.pulse).toBeCloseTo(0.9, 10);
  });

  it("scales intensityFactor linearly with the intensity control", () => {
    const at = (intensity) =>
      computeAudioFeatures(new Uint8Array(4), {
        bufferLength: 4,
        bassBins: 2,
        bassAvg: 0,
        pulse: 0,
        beat: true,
        intensity,
      }).intensityFactor;
    expect(at(0)).toBeCloseTo(0.4, 10);
    expect(at(1)).toBeCloseTo(1.6, 10);
  });
});
