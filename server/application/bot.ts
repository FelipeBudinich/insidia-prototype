import type { Command } from "../../shared/protocol/schema.js";
// Deliberately receives only the same sanitized view a human is allowed to see.
export function botCommand(
  view: any,
  integer: (n: number) => number,
  id: () => string,
): Command | null {
  const choose = <T>(a: T[]) => (a.length === 1 ? a[0] : a[integer(a.length)]);
  const actions = view.self.legalActions as any[],
    prompt = view.self.prompt;
  if (!actions.length) return null;
  let action: any, payload: any;
  if (prompt && !prompt.submitted) {
    action = { type: "game.answerPrompt" };
    let answer: any = { kind: prompt.kind };
    if (prompt.kind === "selectPlayer")
      answer.playerId = choose(prompt.eligiblePlayerIds);
    else if (
      prompt.kind === "selectCard" ||
      prompt.kind === "selectHerejiaCard"
    )
      answer.handCardRef = choose(prompt.eligibleHandCardRefs);
    else if (prompt.kind === "selectCards") {
      const refs = [...prompt.eligibleHandCardRefs];
      answer.handCardRefs = [];
      while (answer.handCardRefs.length < prompt.count) {
        const chosen = choose(refs);
        answer.handCardRefs.push(chosen);
        refs.splice(refs.indexOf(chosen), 1);
      }
    } else if (prompt.kind === "selectPayment")
      answer.choice = prompt.options.includes("pay") ? "pay" : "discard";
    else answer.direction = choose(prompt.options);
    payload = { promptId: prompt.promptId, answer };
  } else if (actions.some((a) => a.type === "game.challenge")) {
    const sin = view.public.interaction.declaredSin;
    const known =
      view.self.hand.filter((c: any) => c.sin === sin).length +
      view.public.players
        .flatMap((p: any) => p.faceUpSins)
        .filter((c: any) => c.sin === sin).length +
      view.public.board.publicCenter.filter((c: any) => c.sin === sin).length;
    const challenge = known >= 3 || integer(100) < 24;
    action = actions.find(
      (a) => a.type === (challenge ? "game.challenge" : "game.passChallenge"),
    );
    payload = { interactionId: action.interactionId };
  } else if (actions.some((a) => a.type === "game.payCounter")) {
    const block =
      view.public.interaction.declaredSin === "ORGULLO" ||
      view.public.interaction.targetPlayerId === view.self.playerId ||
      integer(100) < 12;
    action = actions.find(
      (a) => a.type === (block ? "game.payCounter" : "game.passCounter"),
    );
    payload = { interactionId: action.interactionId };
  } else {
    const claim = actions.find((a) => a.type === "game.declareSin");
    if (claim?.allowedSins.includes("ORGULLO")) {
      action = claim;
      payload = { opportunityId: claim.opportunityId, sin: "ORGULLO" };
    } else if (claim && integer(100) < 65) {
      const held = view.self.hand
        .map((c: any) => c.sin)
        .filter((s: string) => claim.allowedSins.includes(s));
      const sin =
        held.length && integer(100) < 75
          ? choose(held)
          : choose(claim.allowedSins);
      action = claim;
      payload = { opportunityId: claim.opportunityId, sin };
    } else {
      action = choose(actions.filter((a) => a.type !== "game.declareSin"));
      payload = { opportunityId: action.opportunityId };
      if (action.type === "game.forceRandomDiscard")
        payload.targetPlayerId = choose(action.eligiblePlayerIds);
    }
  }
  return {
    protocolVersion: 1,
    kind: "command",
    type: action.type,
    commandId: id(),
    roomId: view.roomId,
    ...(payload.answer?.kind === "selectHerejiaCard"
      ? {}
      : { expectedStateVersion: view.stateVersion }),
    payload,
  };
}
