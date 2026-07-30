// Sentinel for a user-cancelled GIF export. Lives in its own module so
// editorOps can recognise it without statically importing toGIF (and with it
// the gif.js bundle, which is deliberately lazy-loaded).
export const GIF_CANCELLED_ERROR = "gif-export-cancelled";
