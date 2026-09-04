import ig from "../../../lib/impact/impact.js";

// Assets registered here are loaded before the one long-lived Theseus game starts.
export const assets = Object.freeze({
  pecadoBack: new ig.Image("games/insidia/media/pecados-retiro.webp"),
  conspiracyBack: new ig.Image(
    "games/insidia/media/conspiraciones-retiro.webp",
  ),
});
