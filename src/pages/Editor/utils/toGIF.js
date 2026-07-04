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
              onProgress(frameCount / totalFrames);
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

        gif.on("progress", (progress) => onProgress(progress));

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
