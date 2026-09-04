// Local synthetic games only. Persist only the actual viewer projection; never
// serialize Room, RNG/deck state, sealed rows, or another viewer's private hand.
import { writeFile } from "node:fs/promises";
import { fixture } from "../../test/helpers.js";
import { project } from "../../server/projection/project.js";
import { timeout, cleanup, abandon, validateRoom } from "../../server/domain/engine.js";
import { SINS, CONSPIRACIES } from "../../shared/protocol/schema.js";
import type { Sealed } from "../../server/domain/model.js";

function sequence(id: string, name: string, count: number) {
  const f = fixture(count, 17);
  f.room.seats.forEach((seat, index) => {
    seat.displayName = ["María Fernanda del Valle", "José Ignacio", "Antonia", "Sebastián", "Cristóbal", "Ana Sofía"][index];
  });
  const epoch = crypto.randomUUID();
  const frames: any[] = [];
  function capture(label: string, sealed: Sealed[] = []) {
    validateRoom(f.room, f.env);
    const snapshot = project(f.room, f.room.seats[0].playerId, f.env, sealed);
    const serialized = JSON.stringify(snapshot);
    for (const seat of f.room.seats) {
      if (serialized.includes(seat.sessionDigest!)) throw new Error("Session data entered fixture");
      for (const cardId of seat.hand) {
        if (serialized.includes(cardId)) throw new Error("Canonical card ID entered fixture");
        if (seat !== f.room.seats[0] && serialized.includes(f.env.handRef(f.room, seat, f.room.game!.cards[cardId])))
          throw new Error("Other viewer hand reference entered fixture");
      }
    }
    frames.push({ at: frames.length * 1500, label, snapshot: {
      ...snapshot, projectionEpoch: epoch, projectionRevision: String(frames.length + 1),
    } });
    f.advance(250);
  }
  function passAll() {
    while (f.room.game!.phase.kind === "awaitingChallenge") {
      f.run("game.passChallenge");
      capture("Pasa el siguiente jugador");
    }
  }
  function settle() {
    let count = 0;
    while (f.room.status === "active" && f.room.game!.phase.kind !== "awaitingTurnAction") {
      if (++count > 24) throw new Error("Fixture did not settle");
      const phase = f.room.game!.phase;
      if ("deadline" in phase) f.advance(Math.max(0, Date.parse(phase.deadline) - Date.parse(f.env.now())));
      timeout(f.room, f.env);
      f.room.stateVersion++;
      validateRoom(f.room, f.env);
      capture("Plazo resuelto por la autoridad");
    }
  }
  return { f, capture, passAll, settle, finish: () => ({ id, name, frames }) };
}
const results = [];
{
  const s = sequence("souls-proof", "Almas → declaración → prueba pública", 3);
  s.capture("Inicio de turno");
  s.f.run("game.takeSouls");
  s.capture("Dos almas viajan desde el banco");
  s.f.hand(1, "GULA");
  s.f.run("game.declareSin", { sin: "GULA" });
  s.capture("El segundo jugador declara Gula");
  s.f.run("game.challenge");
  s.capture("Prueba verdadera, exposición y consecuencia");
  results.push(s.finish());
}
{
  const s = sequence("envidia", "Envidia → cuatro cartas → retorno ordenado", 4);
  s.capture("Turno con dos cartas");
  s.f.run("game.declareSin", { sin: "ENVIDIA" });
  s.capture("Declara Envidia");
  s.passAll();
  const prompt = s.f.view().self.prompt;
  s.capture("Decisión local: dos espacios numerados");
  s.f.answer({ kind: "selectCards", handCardRefs: prompt.eligibleHandCardRefs.slice(0, 2).reverse() });
  s.capture("Retorno aceptado y nuevo turno");
  results.push(s.finish());
}
{
  const s = sequence("vanidad-herejia", "Vanidad → Herejía → elección sellada → rotación", 6);
  s.f.souls(0, 0);
  s.f.conspiracy("HEREJIA");
  s.capture("Vanidad disponible sin almas");
  s.f.run("game.declareSin", { sin: "VANIDAD" });
  s.capture("Declara Vanidad");
  s.passAll();
  s.capture("Herejía revelada: elegir dirección");
  s.f.answer({ kind: "selectDirection", direction: "right" });
  s.capture("Decisión simultánea: mi mano autorizada");
  const prompt = s.f.view().self.prompt;
  const result = s.f.run("game.answerPrompt", { answer: { kind: "selectHerejiaCard", handCardRef: prompt.eligibleHandCardRefs[0] } });
  const sealed = [result.sealed!];
  s.capture("Solo mi elección figura como sellada", sealed);
  s.f.advance(30000);
  timeout(s.f.room, s.f.env, sealed);
  s.f.room.stateVersion++;
  s.capture("Rotación pública y limpieza al vencer el plazo");
  results.push(s.finish());
}

for (const blocked of [false, true]) {
  const s = sequence(blocked ? "orgullo-blocked" : "orgullo-win", blocked ? "Orgullo bloqueado · ambos pagos permanecen" : "Orgullo · victoria y mesa final", 3);
  s.f.souls(0, 9); s.f.souls(1, 8);
  s.capture("Orgullo disponible");
  s.f.run("game.declareSin", { sin: "ORGULLO" }); s.capture("Declara Orgullo");
  s.passAll();
  s.capture("Contrarrestar después del pago base");
  s.f.run(blocked ? "game.payCounter" : "game.passCounter");
  s.capture(blocked ? "Orgullo bloqueado, pagos confirmados" : "Victoria de Orgullo");
  results.push(s.finish());
}
{
  const s = sequence("caught-bluff", "Farol descubierto · exposición sin pago", 3);
  s.f.souls(0, 10);
  const held = s.f.room.seats[0].hand.map((id) => s.f.room.game!.cards[id].definition);
  const sin = SINS.find((candidate) => !held.includes(candidate))!;
  s.capture("Antes de declarar");
  s.f.run("game.declareSin", { sin }); s.capture("Declaración pública, sin revelar la mano");
  s.f.run("game.challenge"); s.capture("Farol descubierto, exposición sin cobrar la declaración");
  results.push(s.finish());
}
{
  const s = sequence("rabia", "Rabia · objetivo tras desafío y exposición elegida", 3);
  s.f.souls(0, 4); s.f.souls(1, 0); s.f.souls(2, 0);
  s.capture("Rabia disponible");
  s.f.run("game.declareSin", { sin: "RABIA" }); s.capture("Declara Rabia");
  s.passAll();
  s.f.answer({ kind: "selectPlayer", playerId: s.f.room.seats[2].playerId });
  s.capture("Esperando elección privada del objetivo");
  const card = s.f.view(2).self.hand[1];
  s.f.answer({ kind: "selectCard", handCardRef: card.handCardRef });
  s.capture("Pecado elegido ahora expuesto públicamente");
  results.push(s.finish());
}
{
  const s = sequence("avaricia", "Avaricia · transferencia limitada por existencias", 3);
  s.f.souls(1, 1);
  s.capture("La fuente dispone de una sola alma");
  s.f.run("game.declareSin", { sin: "AVARICIA" }); s.capture("Declara Avaricia");
  s.passAll();
  s.f.answer({ kind: "selectPlayer", playerId: s.f.room.seats[1].playerId });
  s.capture("Transferencia parcial, totales enteros autoritativos");
  results.push(s.finish());
}
{
  const s = sequence("lujuria-return-received", "Lujuria · entregar y devolver la carta recibida", 4);
  s.capture("Antes del intercambio");
  s.f.run("game.declareSin", { sin: "LUJURIA" }); s.capture("Declara Lujuria");
  s.passAll();
  s.f.answer({ kind: "selectPlayer", playerId: s.f.room.seats[1].playerId });
  s.capture("El objetivo elige qué entregar en privado");
  const offered = s.f.view(1).self.hand[0];
  s.f.answer({ kind: "selectCard", handCardRef: offered.handCardRef });
  s.capture("Devolver: la carta recibida es una opción legal");
  const received = s.f.view().self.hand.at(-1);
  s.f.answer({ kind: "selectCard", handCardRef: received.handCardRef });
  s.capture("Se devuelve la carta recibida con su referencia vigente");
  results.push(s.finish());
}
{
  const s = sequence("pereza-held-out", "Pereza · prueba retenida, contrarresto y mezcla", 3);
  s.f.hand(0, "PEREZA"); s.f.souls(1, 2); s.f.souls(2, 2);
  s.capture("Antes de declarar Pereza");
  s.f.run("game.declareSin", { sin: "PEREZA" }); s.capture("Declara Pereza");
  s.f.run("game.challenge"); s.capture("Prueba pública retenida durante contrarrestos");
  while (s.f.room.game!.phase.kind === "awaitingCounter") {
    s.f.run("game.passCounter"); s.capture("Pasa contrarresto; continúa la resolución");
  }
  s.capture("Mezcla y reposición, prueba devuelta");
  results.push(s.finish());
}
for (const conspiracy of CONSPIRACIES) {
  const s = sequence(`conspiracy-${conspiracy.toLowerCase()}`, `${conspiracy} · revelar, resolver y limpiar`, 3);
  s.f.conspiracy(conspiracy);
  if (conspiracy === "INDIGENCIA") s.f.souls(0, 5);
  if (conspiracy === "PERFIDIA") {
    s.f.souls(0, 10);
    const held = s.f.room.seats[0].hand.map((id) => s.f.room.game!.cards[id].definition);
    const absent = SINS.find((candidate) => !held.includes(candidate))!;
    s.capture("Preparación: un farol descubierto expondrá un pecado");
    s.f.run("game.declareSin", { sin: absent });
    s.f.run("game.challenge"); s.capture("Pecado expuesto, mano repuesta por la autoridad");
    while (s.f.room.game!.activeSeatIndex !== 0) {
      s.f.run("game.takeSouls"); s.capture("Avanza el turno hasta el actor de Perfidia");
    }
  }
  s.capture("Antes de conspirar");
  s.f.run("game.conspire"); s.capture("Conspiración revelada y decisión autorizada");
  s.settle();
  s.capture("Consecuencia y limpieza terminadas");
  results.push(s.finish());
}
{
  const s = sequence("abandon-envidia", "Abandono · congelar Envidia sin resolver la mano", 3);
  s.capture("Antes de Envidia");
  s.f.run("game.declareSin", { sin: "ENVIDIA" }); s.capture("Declara Envidia");
  s.passAll(); s.capture("Mano ampliada pendiente de elección");
  abandon(s.f.room, s.f.env); s.f.room.stateVersion++;
  s.capture("Abandono: mesa pública congelada, sin devolución inventada");
  results.push(s.finish());
}
for (const draw of [false, true]) {
  const s = sequence(draw ? "final-draw" : "group-elimination", draw ? "Empate · ningún superviviente" : "Eliminación simultánea · asientos estables", 4);
  s.capture("Antes de acumular dos exposiciones");
  for (const [index, seat] of s.f.room.seats.entries()) if (draw || index === 0 || index === 2) {
    seat.faceUpSins.push(...seat.hand); seat.hand = [];
  }
  // Like the existing cleanup domain fixtures, seed the internal exposure
  // condition, then serialize only the validated post-cleanup projection.
  cleanup(s.f.room, s.f.env); s.f.room.stateVersion++;
  s.capture(draw ? "Empate confirmado por el servidor" : "Eliminaciones agrupadas y siguiente actor");
  results.push(s.finish());
}
{
  const s = sequence("history-gap", "Historial truncado · reconciliar después de ausencia", 5);
  s.capture("Último estado recibido antes de ausentarse");
  for (let index = 0; index < 75; index++) s.f.run("game.takeSouls");
  s.capture("El anillo público ya no contiene los primeros efectos");
  results.push(s.finish());
}
const encoded = JSON.stringify({ generatedFrom: "Synthetic domain fixtures through server/projection/project.ts; viewer 0 only", sequences: results }, null, 2);
for (const forbidden of ["cardInstanceId", "sessionDigest", "sinDeck", "conspiracyDeck", "rngState", "completionOrdinal", "cardId"])
  if (encoded.includes(`"${forbidden}"`)) throw new Error(`Forbidden fixture field ${forbidden}`);
await writeFile(new URL("./fixtures.json", import.meta.url), encoded + "\n");
process.stdout.write(`Wrote ${results.length} viewer-only sequences (${results.reduce((sum, seq) => sum + seq.frames.length, 0)} snapshots).\n`);
