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

export function toDesignPoint(point) {
  return {
    x: point.x / RENDER_SCALE,
    y: point.y / RENDER_SCALE,
  };
}
