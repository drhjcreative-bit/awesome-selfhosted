// Recording codec selection. Pulled out of the component so the browser-feature
// branching can be unit-tested by stubbing the global MediaRecorder.

// Return the first webm codec the platform's MediaRecorder supports, or null
// when recording isn't available at all (no MediaRecorder, or none supported).
export const pickRecordingMime = () => {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) || null;
};
