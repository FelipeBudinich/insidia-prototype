import ig from "../../../lib/impact/impact.js";

const image = (path) => new ig.Image(`games/insidia/media/${path}`);

// Assets registered here are loaded before the one long-lived Theseus game starts.
export const assets = Object.freeze({
  pecadoBack: image("pecados-retiro.webp"),
  conspiracyBack: image("conspiraciones-retiro.webp"),
  conspiracyFronts: Object.freeze({
    SUPREMACIA: image("conspiraciones/supremacia.webp"),
    AGONIA: image("conspiraciones/agonia.webp"),
    INDIGENCIA: image("conspiraciones/indigencia.webp"),
    HEREJIA: image("conspiraciones/herejia.webp"),
    PERFIDIA: image("conspiraciones/perfidia.webp"),
    APOSTASIA: image("conspiraciones/apostasia.webp"),
  }),
  pecadoFronts: Object.freeze({
    ORGULLO: image("pecados/orgullo.webp"),
    RABIA: image("pecados/ira.webp"),
    GULA: image("pecados/gula.webp"),
    ENVIDIA: image("pecados/envidia.webp"),
    AVARICIA: image("pecados/avaricia.webp"),
    VANIDAD: image("pecados/vanidad.webp"),
    LUJURIA: image("pecados/lujuria.webp"),
    PEREZA: image("pecados/pereza.webp"),
  }),
});
