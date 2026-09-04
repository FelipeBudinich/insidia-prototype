import ig from "../../lib/impact/impact.js";
import "./media/assets.js";
import { InsidiaGame } from "./game/insidia-game.js";
ig.Sound.enabled = false;
ig.main("#canvas", InsidiaGame, 60, 1920, 1080, 1);
