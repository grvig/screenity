import GIF from "gif.js";
import { GIF_CANCELLED_ERROR } from "./gifCancelled";

export { GIF_CANCELLED_ERROR };

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

// gif.js holds every captured frame as raw RGBA (width * height * 4) until
// rendering finishes, so frame count - not duration - is what runs the tab out
// of memory. With the old 30s cap gone, bound the buffer and trade frame rate
// for length instead, so a long recording exports choppier rather than
// crashing the editor.
const MAX_GIF_FRAME_BUFFER_BYTES = 600 * 1024 * 1024;

export function clampGifFps(duration, outputWidth, outputHeight, fps) {
  const bytesPerFrame = outputWidth * outputHeight * 4;
  if (!bytesPerFrame || !duration || !fps) return fps;
  const maxFrames = Math.max(
    1,
    Math.floor(MAX_GIF_FRAME_BUFFER_BYTES / bytesPerFrame)
  );
  if (Math.floor(duration * fps) <= maxFrames) return fps;
  // Deliberately allowed below 1fps: any floor would break the memory
  // guarantee for long enough input, and a sub-1fps delay is still a valid
  // GIF. Such an export is a bad idea anyway, which the size warning covers.
  return maxFrames / duration;
}

export function estimateGifSizeBytes(
  duration,
  sourceWidth,
  sourceHeight,
  { width = GIF_WIDTH, fps = GIF_FPS, quality = GIF_QUALITY } = {}
) {
  const outputWidth = Math.min(width, sourceWidth || width);
  const height = Math.round((sourceHeight / sourceWidth) * outputWidth);
  // Estimate against the fps that will actually be used, not the requested
  // one, so the size shown matches what the encoder produces.
  const effectiveFps = clampGifFps(duration, outputWidth, height, fps);
  const totalFrames = Math.max(1, Math.floor(duration * effectiveFps));
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

// Everything the export UIs need about a pending export: the estimated size and
// any heads-up lines, most important first. Returned together so the size shown
// and the size the warning threshold was tested against can't drift apart.
// Reducing fps also shrinks the file, so a frame-rate drop never trips the size
// warning - without its own notice the GIF just comes out mysteriously choppy.
export function getGifExportPreview(
  duration,
  sourceWidth,
  sourceHeight,
  preset
) {
  if (!duration || !sourceWidth || !sourceHeight) {
    return { estimatedBytes: null, notices: [] };
  }

  const outputWidth = Math.min(preset.width, sourceWidth);
  const outputHeight = Math.round((sourceHeight / sourceWidth) * outputWidth);

  const estimatedBytes = estimateGifSizeBytes(
    duration,
    sourceWidth,
    sourceHeight,
    preset
  );

  const notices = [];
  const sizeWarning = getGifSizeWarningMessage(estimatedBytes);
  if (sizeWarning) notices.push(sizeWarning);

  const effectiveFps = clampGifFps(
    duration,
    outputWidth,
    outputHeight,
    preset.fps
  );
  if (effectiveFps < preset.fps) {
    const shown =
      effectiveFps >= 1 ? Math.round(effectiveFps) : effectiveFps.toFixed(1);
    notices.push(
      chrome.i18n.getMessage("gifReducedFrameRateNotice", [String(shown)]) ||
        `Frame rate reduced to ${shown} fps to fit this length`
    );
  }

  return { estimatedBytes, notices };
}

export function getGifSizeWarningMessage(estimatedBytes) {
  if (estimatedBytes < GIF_SIZE_WARNING_THRESHOLD_BYTES) return null;
  const size = formatGifSizeBytes(estimatedBytes);
  const message = chrome.i18n.getMessage("downloadGIFSizeWarning", [size]);
  return message || `Export as GIF (~${size})`;
}

async function toGIF(ffmpeg, videoBlob, onProgress = () => {}, options = {}) {
  const shouldCancel = options.shouldCancel || (() => false);
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
        const requestedFps = options.fps || GIF_FPS;
        const fps = clampGifFps(duration, width, height, requestedFps);
        if (fps !== requestedFps) {
          console.warn(
            `[Screenity][GIF] ${duration.toFixed(1)}s at ${width}x${height} ` +
              `would exceed the frame buffer budget; reduced ${requestedFps}fps ` +
              `to ${fps.toFixed(2)}fps`
          );
        }
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

        // abort() also terminates the render workers, so this covers a cancel
        // during either phase.
        gif.on("abort", () => {
          URL.revokeObjectURL(video.src);
          video.remove();
          reject(new Error(GIF_CANCELLED_ERROR));
        });

        for (let i = 0; i < totalFrames; i++) {
          if (shouldCancel()) {
            gif.abort();
            return;
          }
          const time = Math.min(i * frameInterval, duration - 0.001);
          await captureFrame(time);
        }

        gif.on("finished", (blob) => {
          URL.revokeObjectURL(video.src);
          video.remove();
          onProgress(1);
          resolve(blob);
        });

        gif.on("progress", (progress) => {
          if (shouldCancel()) {
            gif.abort();
            return;
          }
          onProgress(
            CAPTURE_PROGRESS_SHARE + (1 - CAPTURE_PROGRESS_SHARE) * progress
          );
        });

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
