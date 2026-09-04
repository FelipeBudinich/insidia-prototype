import ig from "../../lib/impact/impact.js";
import "./media/assets.js";
import { InsidiaGame } from "./game/insidia-game.js";
import { CANVAS_HEIGHT, CANVAS_WIDTH } from "./resolution.js";
ig.Sound.enabled = false;
ig.main("#canvas", InsidiaGame, 60, CANVAS_WIDTH, CANVAS_HEIGHT, 1);
