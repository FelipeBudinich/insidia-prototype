// All layout coordinates are CSS pixels. Seats keep immutable clockwise order.
function composeLayout(width, height, view) {
  const compact = width < 1200 || height < 650;
  const short = height < 500;
  const rail = compact ? 284 : 330;
  const tableWidth = Math.max(300, width - rail - 36);
  const handHeight = short ? 128 : Math.min(246, height * .29);
  const handTop = height - handHeight - 12;
  const players = [...(view?.public.players ?? [])].sort((a, b) => a.seatIndex - b.seatIndex);
  const selfIndex = Math.max(0, players.findIndex(p => p.playerId === view?.self.playerId));
  const ordered = players.map((_, i) => players[(selfIndex + i) % players.length]);
  const seatW = Math.min(compact ? 180 : 212, (tableWidth - 48) / 3);
  const tight = short && height < 380;
  const seatH = short ? (tight ? 70 : 80) : 112;
  const left = 12, right = tableWidth - seatW - 12, middle = (tableWidth - seatW) / 2;
  const top = short ? (tight ? 54 : 58) : 76;
  const side = short ? (tight ? 132 : 146) : Math.min(handTop - seatH - 26, (top + handTop) / 2 - 25);
  const positions = {
    3: [[left, top], [right, top]],
    4: [[left, side], [middle, top], [right, side]],
    5: [[left, side], [left + 28, top], [right - 28, top], [right, side]],
    6: [[left, side], [left, top], [middle, top], [right, top], [right, side]],
  }[players.length] ?? [];
  const seats = ordered.slice(1).map((p, i) => ({ playerId: p.playerId, x: positions[i]?.[0] ?? left, y: positions[i]?.[1] ?? top, w: seatW, h: seatH }));
  const local = { playerId: ordered[0]?.playerId, x: 12, y: handTop + (short ? 0 : 24), w: short ? (tableWidth < 480 ? 76 : 124) : 180, h: short ? 116 : 166 };
  seats.push(local);
  const handLeft = local.x + local.w + 16;
  const handArea = tableWidth - handLeft - 12;
  const permittedHand = view?.self.hand ?? [];
  const cards = permittedHand.length ? permittedHand : Array.from({ length: ordered[0]?.handCount ?? 0 }, () => ({ back: true }));
  const cardW = Math.min(short ? 80 : 134, (handHeight - 30) * 5 / 7, (handArea - Math.max(0, cards.length - 1) * 12) / Math.max(1, cards.length));
  const total = cards.length * cardW + Math.max(0, cards.length - 1) * 12;
  const hand = cards.map((card, i) => ({ ...card, x: handLeft + (handArea - total) / 2 + i * (cardW + 12), y: height - cardW * 7 / 5 - 14, w: cardW, h: cardW * 7 / 5 }));
  const stageW = short ? Math.max(112, tableWidth - 2 * seatW - 48) : Math.min(350, tableWidth - 2 * seatW - 48);
  const stage = { x: (tableWidth - stageW) / 2, y: short ? (tight ? 132 : 146) : top + seatH + 26, w: stageW, h: short ? 78 : Math.max(130, side + seatH - top - seatH - 40) };
  const resources = { x: 16, y: handTop - 26, w: tableWidth - 32, h: 24 };
  const exposure = [];
  for (const seat of seats) {
    const player = players.find(p => p.playerId === seat.playerId);
    const isLocal = seat === local;
    (player?.faceUpSins ?? []).forEach((card, i) => {
      const w = short ? 21 : 31;
      exposure.push({ ...card, playerId: player.playerId, index: i, x: seat.x + seat.w - (i + 1) * (w + 7), y: seat.y + (isLocal ? 68 : short ? (tight ? 36 : 43) : 62), w, h: w * 7 / 5 });
    });
  }
  return { width, height, compact, short, tableWidth, seats, hand, exposure, local, stage, resources, handTop,
    decision: { x: width - rail - 12, y: 64, w: rail, h: height - 80 },
    utility: { x: 12, y: 8, w: width - 24, h: 44 },
    inspector: { x: 12, y: 58, w: Math.min(420, tableWidth - 24), h: Math.max(160, handTop - 74) },
    history: { x: 12, y: 58, w: Math.min(440, tableWidth - 24), h: Math.max(160, handTop - 74) },
    anchors: { bank: { x: tableWidth / 2, y: short || height < 850 ? resources.y + 12 : handTop - 104 }, deck: { x: tableWidth / 2 - 142, y: short || height < 850 ? resources.y + 12 : handTop - 112 }, stage: { x: stage.x + stage.w / 2, y: stage.y + stage.h / 2 } },
  };
}

export function activeNeighbor(view, playerId, direction) {
  const players = [...view.public.players].sort((a, b) => a.seatIndex - b.seatIndex).filter(p => p.status !== 'eliminated');
  const i = players.findIndex(p => p.playerId === playerId);
  return players[(i + (direction === 'right' ? 1 : players.length - 1)) % players.length]?.playerId;
}

// Respect landscape cutouts without a CSS transform or a second pointer scale.
export function boardLayout(width, height, view, insets = {}) {
  const left=insets.left||0, top=insets.top||0, right=insets.right||0, bottom=insets.bottom||0;
  const layout=composeLayout(width-left-right,height-top-bottom,view);
  if(left||top||right||bottom){
    const rects=new Set([...layout.seats,...layout.hand,...layout.exposure,layout.stage,layout.resources,layout.utility,layout.decision,layout.inspector,layout.history]);
    for(const rect of rects){rect.x+=left;rect.y+=top;}
    for(const anchor of Object.values(layout.anchors)){anchor.x+=left;anchor.y+=top;}
    layout.width=width;layout.height=height;layout.tableWidth+=left;layout.handTop+=top;
  }
  return layout;
}
