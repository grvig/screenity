import React, { useContext, useEffect, useState } from "react";
import styles from "../../styles/player/_MinimalGifExportScreen.module.scss";

import { ContentStateContext } from "../../context/ContentState";
import {
  estimateGifSizeBytes,
  formatGifSizeBytes,
  getGifProgressLabel,
  getGifSizeWarningMessage,
  GIF_QUALITY_PRESETS,
} from "../../../Editor/utils/toGIF";

// Standalone screen for recordings made via the "Recording for GIF" popup
// toggle: preview, one quality slider, download — no trim/crop/other panels.
const MinimalGifExportScreen = () => {
  const [contentState, setContentState] = useContext(ContentStateContext);
  const [presetIndex, setPresetIndex] = useState(1); // "Balanced"
  const [previewUrl, setPreviewUrl] = useState(null);
  const preset = GIF_QUALITY_PRESETS[presetIndex];

  useEffect(() => {
    const source = contentState.blob || contentState.webm;
    if (!source) return;
    const url = URL.createObjectURL(source);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [contentState.blob, contentState.webm]);

  const estimatedBytes =
    contentState.width && contentState.height && contentState.duration
      ? estimateGifSizeBytes(
          contentState.duration,
          contentState.width,
          contentState.height,
          preset
        )
      : null;

  return (
    <div className={styles.wrap}>
      <div className={styles.preview}>
        {previewUrl && (
          <video className={styles.video} src={previewUrl} controls muted />
        )}
      </div>
      <div className={styles.panel}>
        <div className={styles.title}>
          {chrome.i18n.getMessage("downloadGIFButtonTitle")}
        </div>
        <div className={styles.sliderRow}>
          <span className={styles.sliderLabel}>
            {chrome.i18n.getMessage(preset.labelKey)}
          </span>
          <input
            type="range"
            min={0}
            max={GIF_QUALITY_PRESETS.length - 1}
            step={1}
            value={presetIndex}
            onChange={(e) => setPresetIndex(Number(e.target.value))}
            title={chrome.i18n.getMessage("gifQualityLabel")}
          />
        </div>
        {estimatedBytes != null && (
          <div className={styles.estimate}>
            {getGifSizeWarningMessage(estimatedBytes) ||
              `~${formatGifSizeBytes(estimatedBytes)}`}
          </div>
        )}
        <button
          className={styles.downloadButton}
          disabled={
            contentState.downloadingGIF ||
            !contentState.mp4ready ||
            contentState.noffmpeg
          }
          onClick={() => contentState.downloadGIF(preset)}
        >
          {contentState.downloadingGIF
            ? getGifProgressLabel(contentState.processingProgress)
            : chrome.i18n.getMessage("downloadGIFButtonTitle")}
        </button>
        <button
          className={styles.exitLink}
          onClick={() =>
            setContentState((prev) => ({ ...prev, gifCaptureMode: false }))
          }
        >
          {chrome.i18n.getMessage("openFullEditorLabel")}
        </button>
      </div>
    </div>
  );
};

export default MinimalGifExportScreen;
