// Pull the last frame out of a take's video. Works on data-URL webm (mock
// takes) always; on remote MP4s it needs CORS headers — returns null on a
// tainted canvas instead of throwing.

export async function lastFrameOf(videoSrc: string, maxW = 1280): Promise<string | null> {
  const v = document.createElement("video");
  v.crossOrigin = "anonymous";
  v.muted = true;
  v.preload = "auto";
  v.src = videoSrc;
  try {
    await new Promise<void>((res, rej) => {
      v.onloadedmetadata = () => res();
      v.onerror = () => rej(new Error("video failed to load"));
      setTimeout(() => rej(new Error("video load timeout")), 15000);
    });
    // seek to (nearly) the end; some encoders can't seek to exact duration
    v.currentTime = Math.max(0, (Number.isFinite(v.duration) ? v.duration : 0) - 0.05);
    await new Promise<void>((res, rej) => {
      v.onseeked = () => res();
      v.onerror = () => rej(new Error("seek failed"));
      setTimeout(() => rej(new Error("seek timeout")), 10000);
    });
    const scale = Math.min(1, maxW / (v.videoWidth || maxW));
    const c = document.createElement("canvas");
    c.width = Math.round((v.videoWidth || 1280) * scale);
    c.height = Math.round((v.videoHeight || 720) * scale);
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.88); // throws on tainted canvas
  } catch {
    return null;
  } finally {
    v.removeAttribute("src");
    v.load();
  }
}
