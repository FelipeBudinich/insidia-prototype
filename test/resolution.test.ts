import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  DESIGN_HEIGHT,
  DESIGN_WIDTH,
  fitCanvasToViewport,
  RENDER_SCALE,
  toDesignPoint,
} from "../public/games/insidia/resolution.js";

test("the canvas uses a uniform 3840x2160 render scale", () => {
  assert.equal(CANVAS_WIDTH, 3840);
  assert.equal(CANVAS_HEIGHT, 2160);
  assert.equal(DESIGN_WIDTH, 1600);
  assert.equal(DESIGN_HEIGHT, 900);
  assert.equal(RENDER_SCALE, 2.4);
  assert.equal(CANVAS_HEIGHT / DESIGN_HEIGHT, RENDER_SCALE);

  const html = readFileSync(
    new URL("../public/games/insidia/index.html", import.meta.url),
    "utf8",
  );
  assert.match(
    html,
    /<canvas\s+id="canvas"\s+width="3840"\s+height="2160"/,
  );
});

test("the canvas fits and centers within common viewports", () => {
  assert.deepEqual(fitCanvasToViewport(3840, 2160), {
    width: 3840,
    height: 2160,
    left: 0,
    top: 0,
  });
  assert.deepEqual(fitCanvasToViewport(1920, 1080), {
    width: 1920,
    height: 1080,
    left: 0,
    top: 0,
  });
  assert.deepEqual(fitCanvasToViewport(1440, 1000), {
    width: 1440,
    height: 810,
    left: 0,
    top: 95,
  });
  assert.deepEqual(fitCanvasToViewport(1800, 900), {
    width: 1600,
    height: 900,
    left: 100,
    top: 0,
  });
});

test("native and CSS-downscaled pointer positions map to design coordinates", () => {
  const designPoint = { x: 683, y: 356 };
  const outputPoint = {
    x: designPoint.x * RENDER_SCALE,
    y: designPoint.y * RENDER_SCALE,
  };
  assert.deepEqual(toDesignPoint(outputPoint), designPoint);

  for (const [viewportWidth, viewportHeight] of [
    [3840, 2160],
    [1920, 1080],
    [1440, 1000],
  ]) {
    const layout = fitCanvasToViewport(viewportWidth, viewportHeight);
    const cssScale = layout.width / CANVAS_WIDTH;
    const clientPoint = {
      x: layout.left + outputPoint.x * cssScale,
      y: layout.top + outputPoint.y * cssScale,
    };
    const impactPoint = {
      x: (clientPoint.x - layout.left) / cssScale,
      y: (clientPoint.y - layout.top) / cssScale,
    };
    assert.deepEqual(toDesignPoint(impactPoint), designPoint);
  }
});

import { viewportResolution } from '../public/games/insidia/resolution.js';
test('responsive backing is bounded and pointer coordinates round-trip at every QA viewport',()=>{
  for(const [w,h] of [[1440,900],[1280,720],[1024,768],[844,390]])for(const dpr of [1,1.5,2,3]){
    const l=viewportResolution(w,h,dpr);assert.equal(l.width,w);assert.equal(l.height,h);assert(l.renderScale<=2);
    const css={x:w*.4,y:h*.6};
    const p=toDesignPoint({x:css.x*l.renderScale,y:css.y*l.renderScale},l.renderScale);
    assert(Math.abs(p.x-css.x)<1e-8&&Math.abs(p.y-css.y)<1e-8);
    assert.equal(l.backingWidth,Math.round(w*l.renderScale));
  }
});
