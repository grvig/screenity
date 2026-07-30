import GIF from "gif.js";

export const GIF_WIDTH = 540;
export const GIF_FPS = 12;
export const GIF_QUALITY = 5;

// Single slider preset scale shared by the full and minimal export UIs.
export const GIF_QUALITY_PRESETS = [
  { labelKey: "gifQualitySmall", width: 360, fps: 10, quality: 15 },
  { labelKey: "gifQualityBalanced", width: GIF_WIDTH, fps: GIF_FPS, quality: GIF_QUALITY },
  { labelKey: "gifQualityBest", width: 720, fps: 15, quality: 3 },
];

// Fraction of reported progress spent seeking/drawing frames before gif.js
// starts encoding them.
const CAPTURE_PROGRESS_SHARE = 0.5;

// Empirical bytes-per-pixel-per-frame for gif.js at GIF_QUALITY on typical
// screen-recording content (mostly flat color, some text/cursor motion).
const GIF_BYTES_PER_PIXEL_PER_FRAME = 0.045;

export function estimateGifSizeBytes(
  duration,
  sourceWidth,
  sourceHeight,
  { width = GIF_WIDTH, fps = GIF_FPS, quality = GIF_QUALITY } = {}
) {
  const outputWidth = Math.min(width, sourceWidth || width);
  const height = Math.round((sourceHeight / sourceWidth) * outputWidth);
  const totalFrames = Math.max(1, Math.floor(duration * fps));
  // Higher gif.js "quality" values sample colors less often (smaller/worse).
  const qualityFactor = 5 / quality;
  return (
    outputWidth *
    height *
    totalFrames *
    GIF_BYTES_PER_PIXEL_PER_FRAME *
    qualityFactor
  );
}

// Shared by the full RightPanel and the minimal export screen so both show
// the same size and the same large-export heads-up.
export function formatGifSizeBytes(bytes) {
  const mb = bytes / (1024 * 1024);
  return mb >= 1000 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

// GIF encoding has no cap now, so long exports can run a while; show the
// percentage rather than an indefinite "Downloading…".
export function getGifProgressLabel(processingProgress) {
  const base = chrome.i18n.getMessage("downloadingLabel");
  const pct = Math.round(processingProgress || 0);
  return pct > 0 && pct < 100 ? `${base} (${pct}%)` : base;
}

export const GIF_SIZE_WARNING_THRESHOLD_BYTES = 15 * 1024 * 1024;

export function getGifSizeWarningMessage(estimatedBytes) {
  if (estimatedBytes < GIF_SIZE_WARNING_THRESHOLD_BYTES) return null;
  const size = formatGifSizeBytes(estimatedBytes);
  const message = chrome.i18n.getMessage("downloadGIFSizeWarning", [size]);
  return message || `Export as GIF (~${size})`;
}

async function toGIF(ffmpeg, videoBlob, onProgress = () => {}, options = {}) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    video.addEventListener("loadedmetadata", async () => {
      try {
        const duration = video.duration;
        const width = Math.min(
          options.width || GIF_WIDTH,
          video.videoWidth
        );
        const height = Math.round(
          (video.videoHeight / video.videoWidth) * width
        );
        const fps = options.fps || GIF_FPS;
        const quality = options.quality || GIF_QUALITY;

        canvas.width = width;
        canvas.height = height;

        const gif = new GIF({
          workers: Math.max(2, Math.min(4, navigator.hardwareConcurrency || 2)),
          quality,
          width,
          height,
          workerScript: "/assets/vendor/gif.js/gif.worker.js",
        });

        const frameInterval = 1 / fps;
        const totalFrames = Math.floor(duration * fps);
        let frameCount = 0;

        const captureFrame = (time) =>
          new Promise((resolveFrame) => {
            const seekHandler = () => {
              video.removeEventListener("seeked", seekHandler);
              ctx.drawImage(video, 0, 0, width, height);
              gif.addFrame(canvas, {
                copy: true,
                delay: Math.round(1000 / fps),
              });
              frameCount++;
              // Frame capture is the first half of the bar and gif.js's
              // own render pass is the second, so progress stays monotonic
              // instead of running 0->100 twice.
              onProgress(CAPTURE_PROGRESS_SHARE * (frameCount / totalFrames));
              resolveFrame();
            };
            video.addEventListener("seeked", seekHandler);
            video.currentTime = time;
          });

        for (let i = 0; i < totalFrames; i++) {
          const time = Math.min(i * frameInterval, duration - 0.001);
          await captureFrame(time);
        }

        gif.on("finished", (blob) => {
          URL.revokeObjectURL(video.src);
          video.remove();
          onProgress(1);
          resolve(blob);
        });

        gif.on("progress", (progress) =>
          onProgress(
            CAPTURE_PROGRESS_SHARE + (1 - CAPTURE_PROGRESS_SHARE) * progress
          )
        );

        gif.render();
      } catch (error) {
        URL.revokeObjectURL(video.src);
        video.remove();
        reject(error);
      }
    });

    video.addEventListener("error", (e) => {
      URL.revokeObjectURL(video.src);
      reject(new Error(`Video error: ${e.message || "Unknown error"}`));
    });

    video.src = URL.createObjectURL(videoBlob);
    video.load();
  });
}

export default toGIF;
