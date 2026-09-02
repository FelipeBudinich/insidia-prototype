export const sins = {
  ORGULLO: {
    name: "Orgullo",
    cost: 9,
    symbol: "♛",
    color: "#dab77a",
    motto: "El último pecado.",
    description:
      "Gana la partida. Un rival puede pagar 8 almas para impedirlo.",
  },
  RABIA: {
    name: "Rabia",
    cost: 4,
    symbol: "✷",
    color: "#ca7064",
    motto: "La furia deja huellas.",
    description:
      "Elige a un rival: debe revelar un pecado de su mano. Se puede bloquear con 3 almas.",
  },
  GULA: {
    name: "Gula",
    cost: 0,
    symbol: "☾",
    color: "#aba8ce",
    motto: "Nunca es suficiente.",
    description: "Toma hasta 3 almas del banco.",
  },
  ENVIDIA: {
    name: "Envidia",
    cost: 0,
    symbol: "◈",
    color: "#87b39d",
    motto: "Lo ajeno te llama.",
    description:
      "Roba 2 pecados. Devuelve 2 al fondo del mazo, en el orden que elijas.",
  },
  AVARICIA: {
    name: "Avaricia",
    cost: 0,
    symbol: "◇",
    color: "#ceb67c",
    motto: "Todo tiene un precio.",
    description: "Roba hasta 2 almas de otro jugador.",
  },
  VANIDAD: {
    name: "Vanidad",
    cost: 0,
    symbol: "✧",
    color: "#bc91b8",
    motto: "Mira lo que has hecho.",
    description: "Revela y resuelve una conspiración sin pagar la entrada.",
  },
  LUJURIA: {
    name: "Lujuria",
    cost: 0,
    symbol: "♡",
    color: "#c78d9b",
    motto: "El deseo es mutuo.",
    description:
      "Un rival te da un pecado. Después le devuelves uno; puede ser el mismo.",
  },
  PEREZA: {
    name: "Pereza",
    cost: 0,
    symbol: "∞",
    color: "#91adbf",
    motto: "Deja que todo cambie.",
    description:
      "Mezcla las manos de todos los jugadores activos en el mazo. Se puede bloquear con 2 almas.",
  },
};
export const conspiracies = {
  SUPREMACIA: [
    "Supremacía",
    "Quien tenga menos almas toma hasta 3. Tú resuelves los empates.",
  ],
  AGONIA: [
    "Agonía",
    "Quien tenga más almas devuelve hasta 3. Tú resuelves los empates.",
  ],
  INDIGENCIA: ["Indigencia", "Paga 3 almas o revela un pecado al azar."],
  HEREJIA: [
    "Herejía",
    "Elige una dirección. Todos pasan un pecado al vecino, simultáneamente.",
  ],
  PERFIDIA: [
    "Perfidia",
    "Devuelve tu pecado expuesto al mazo. Si no tienes, toma 2 almas.",
  ],
  APOSTASIA: [
    "Apostasía",
    "Devuelve un pecado al fondo del mazo y roba uno nuevo.",
  ],
};
export const errors = {
  STALE_STATE: "La mesa ha cambiado. Elige de nuevo.",
  NOT_READY: "Todos los jugadores deben estar listos.",
  NOT_HOST: "Solo el anfitrión puede hacer eso.",
  INVALID_ROOM_CONFIG: "La mesa debe tener entre 3 y 6 jugadores.",
  ROOM_NOT_FOUND_OR_UNAVAILABLE:
    "No encontramos una plaza disponible en esa sala.",
  ROOM_FULL: "La sala está completa.",
  INSUFFICIENT_SOULS: "No tienes suficientes almas.",
  NOT_YOUR_TURN: "Espera tu turno.",
  INVALID_PHASE: "Esta decisión ya terminó.",
  DEADLINE_EXPIRED: "Se acabó el tiempo para responder.",
  RATE_LIMITED: "Un momento. Inténtalo de nuevo en unos segundos.",
  ALREADY_IN_ROOM: "Ya tienes una sala. Recuperando tu lugar…",
  CONNECTION_SUPERSEDED: "Tu sesión está abierta en otra pestaña.",
  MATCH_INTEGRITY_FAILURE: "La partida no está disponible.",
  CARD_NOT_OWNED: "Selecciona una carta de tu mano.",
  AUTH_REQUIRED: "Reconectando tu sesión…",
};
export const purposes = {
  rabiaTarget: "¿Quién recibe tu rabia?",
  rabiaExposeCard: "Elige el pecado que vas a revelar",
  envidiaBottomOrder: "Devuelve dos pecados, en orden",
  avariciaTarget: "¿A quién le robarás las almas?",
  lujuriaTarget: "Elige con quién intercambiar",
  lujuriaGiveCard: "Elige el pecado que vas a entregar",
  lujuriaReturnCard: "Elige el pecado que vas a devolver",
  supremaciaTieTarget: "Elige quién recibe las almas",
  agoniaTieTarget: "Elige quién pierde las almas",
  indigenciaChoice: "El precio de la indigencia",
  herejiaDirection: "Elige hacia dónde pasan los pecados",
  herejiaCards: "Elige un pecado para tu vecino",
  apostasiaCard: "Elige el pecado que vas a cambiar",
};
export function effectText(e, players) {
  const n = (id) =>
      players.find((p) => p.playerId === id)?.displayName ?? "Alguien",
    a = n(e.actorPlayerId),
    t = n(e.targetPlayerId);
  switch (e.kind) {
    case "gameStarted":
      return "Las almas están repartidas. Comienza la insidia.";
    case "sinDeclared":
      return `${a} declara ${sins[e.sin].name}.`;
    case "challengePassed":
      return `${a} deja pasar.`;
    case "claimChallenged":
      return `${a} desafía a ${t}.`;
    case "claimProven":
      return `${a} demuestra ${sins[e.sin].name}.`;
    case "sinExposed":
      return `${a} revela ${sins[e.sin].name}.`;
    case "soulsGained":
      return `${a} toma ${e.amount} almas.`;
    case "soulsPaid":
      return `${a} paga ${e.amount} almas.`;
    case "soulsStolen":
      return `${a} roba ${e.amount} almas a ${t}.`;
    case "conspiracyRevealed":
      return `${a} revela ${conspiracies[e.conspiracy][0]}.`;
    case "playerEliminated":
      return `${a} queda eliminado.`;
    case "cardTransferred":
      return `${a} entrega un pecado a ${t}.`;
    case "cardsExchanged":
      return `${a} cambia sus pecados.`;
    case "cardsRotated":
      return "Los pecados cambian de manos.";
    case "sinCountered":
      return `${a} bloquea ${sins[e.sin].name}.`;
    case "handsShuffled":
      return "Todas las manos vuelven al mazo.";
    case "sinForgiven":
      return `${a} oculta su pecado expuesto.`;
    case "gameFinished":
      return "La partida ha terminado.";
    case "targetSelected":
      return `${a} elige a ${t}.`;
    default:
      return "";
  }
}
