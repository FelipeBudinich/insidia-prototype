export const DESIGN_WIDTH = 1600;
export const DESIGN_HEIGHT = 900;
export const CANVAS_WIDTH = 3840;
export const CANVAS_HEIGHT = 2160;
export const RENDER_SCALE = CANVAS_WIDTH / DESIGN_WIDTH;

if (CANVAS_HEIGHT / DESIGN_HEIGHT !== RENDER_SCALE) {
  throw new Error("Canvas and design dimensions must use the same scale");
}

export function fitCanvasToViewport(viewportWidth, viewportHeight) {
  const scale = Math.min(
    viewportWidth / CANVAS_WIDTH,
    viewportHeight / CANVAS_HEIGHT,
  );
  const width = CANVAS_WIDTH * scale;
  const height = CANVAS_HEIGHT * scale;
  return {
    width,
    height,
    left: (viewportWidth - width) / 2,
    top: (viewportHeight - height) / 2,
  };
}

export function toDesignPoint(point, scale = RENDER_SCALE) {
  return {
    x: point.x / scale,
    y: point.y / scale,
  };
}

// Responsive mode uses CSS-pixel composition and one uniform backing scale.
// Legacy exports above remain available for authored fixed-resolution assets.
export function viewportResolution(width, height, devicePixelRatio = 1) {
  width = Math.max(1, Math.floor(width));
  height = Math.max(1, Math.floor(height));
  const renderScale = Math.max(1, Math.min(2, Number(devicePixelRatio) || 1));
  return { width, height, left: 0, top: 0, renderScale,
    backingWidth: Math.round(width * renderScale),
    backingHeight: Math.round(height * renderScale) };
}
