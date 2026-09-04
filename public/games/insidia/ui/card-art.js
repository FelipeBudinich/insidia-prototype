export function drawImageAsset(
  ctx,
  image,
  x,
  y,
  w,
  h,
  radius = 0,
  fit = "stretch",
) {
  if (!image?.loaded || !image.data) return false;
  let sourceX = 0,
    sourceY = 0,
    sourceWidth = image.width,
    sourceHeight = image.height;
  if (fit === "cover") {
    const sourceRatio = sourceWidth / sourceHeight,
      targetRatio = w / h;
    if (sourceRatio > targetRatio) {
      sourceWidth = sourceHeight * targetRatio;
      sourceX = (image.width - sourceWidth) / 2;
    } else if (sourceRatio < targetRatio) {
      sourceHeight = sourceWidth / targetRatio;
      sourceY = (image.height - sourceHeight) / 2;
    }
  }
  const source = image.getSourceRect(
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
  );
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.clip();
  ctx.drawImage(
    image.data,
    source.x,
    source.y,
    source.width,
    source.height,
    x,
    y,
    w,
    h,
  );
  ctx.restore();
  return true;
}
