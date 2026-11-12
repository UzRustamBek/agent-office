// Procedural pixel-art character. 16 x 26 sprite space, feet at the bottom.
// Every direction, walk cycle and pose is generated from rectangles, so the
// whole cast needs no image assets and any look can be customised in JSON.

import { OUTLINE, SHOE, mix, resolveHair, resolveSkin, shade } from './palette.js';

export const SPRITE_W = 16;
export const SPRITE_H = 26;

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} look  { skin, hair, hairColor, shirt, pants, accessory }
 * @param {object} o
 *   x,y       feet position (logical px, bottom center)
 *   dir       'down' | 'up' | 'left' | 'right'
 *   moving    walking animation on/off
 *   phase     walk cycle phase (any number, 1 = one full step)
 *   arms      'rest' | 'type' | 'fast' | 'read' | 'chin' | 'raise' | 'ask' | 'cross' | 'search' | 'cup' | 'sleep'
 *   t         time in seconds (for small animations)
 *   sink      px to push the body down (seated behind a desk)
 *   shadow    draw a ground shadow
 *   blink     eyes closed this frame
 *   alpha     opacity
 */
export function drawCharacter(ctx, look, o) {
  const { x, y, dir = 'down', moving = false, phase = 0, arms = 'rest', t = 0, sink = 0, shadow = true, blink = false, alpha = 1 } = o;

  const skin = resolveSkin(look.skin);
  const skinD = shade(skin, -30);
  const hair = resolveHair(look.hairColor);
  const hairD = shade(hair, -32);
  const hairL = shade(hair, 28);
  const shirt = look.shirt;
  const shirtD = shade(shirt, -38);
  const shirtL = shade(shirt, 26);
  const pants = look.pants;
  const pantsD = shade(pants, -24);
  const acc = look.accessory || 'none';
  const style = look.hair || 'short';

  const ox = Math.round(x) - 8;
  const oy = Math.round(y + sink) - SPRITE_H;
  const mirror = dir === 'right';
  const side = dir === 'left' || dir === 'right';
  const back = dir === 'up';

  const prevAlpha = ctx.globalAlpha;
  if (alpha !== 1) ctx.globalAlpha = prevAlpha * alpha;

  const R = (lx, ly, w, h, c) => {
    ctx.fillStyle = c;
    ctx.fillRect(ox + (mirror ? SPRITE_W - lx - w : lx), oy + ly, w, h);
  };

  // walk cycle
  const s = moving ? Math.sin(phase * Math.PI * 2) : 0;
  const lLift = s > 0.35 ? 1 : 0;
  const rLift = s < -0.35 ? 1 : 0;
  const bob = moving && Math.abs(s) > 0.75 ? -1 : 0;
  const swing = moving ? Math.round(s * 2) : 0;
  const dy = bob;

  if (shadow && sink === 0) {
    ctx.globalAlpha = (alpha !== 1 ? prevAlpha * alpha : prevAlpha) * 0.22;
    R(2, 24, 12, 2, '#000000');
    ctx.globalAlpha = alpha !== 1 ? prevAlpha * alpha : prevAlpha;
  }

  // ---- legs & shoes --------------------------------------------------------
  if (side) {
    const a = moving ? swing : 0;
    R(6 - a, 19, 3, 5 - lLift, pantsD);
    R(6 - a, 24 - lLift, 4, 2, SHOE);
    R(7 + a, 19, 3, 5 - rLift, pants);
    R(7 + a, 24 - rLift, 4, 2, SHOE);
  } else {
    R(5, 19, 3, 5 - lLift, pants);
    R(8, 19, 3, 5 - rLift, pants);
    R(5, 24 - lLift, 3, 2, SHOE);
    R(8, 24 - rLift, 3, 2, SHOE);
    R(7, 19, 2, 3, pantsD);
  }

  // ---- torso ---------------------------------------------------------------
  if (side) {
    R(5, 11 + dy, 6, 8, shirt);
    R(5, 17 + dy, 6, 2, shirtD);
    R(5, 11 + dy, 6, 1, shirtL);
  } else {
    R(4, 11 + dy, 8, 8, shirt);
    R(4, 17 + dy, 8, 2, shirtD);
    R(4, 11 + dy, 8, 1, shirtL);
    R(11, 12 + dy, 1, 5, shirtD);
    if (!back && acc === 'tie') {
      R(7, 11 + dy, 2, 1, '#f1efe8');
      R(7, 12 + dy, 2, 6, '#c0392b');
      R(7, 12 + dy, 2, 1, '#e5574a');
    }
  }

  // ---- arms ----------------------------------------------------------------
  const hand = (lx, ly) => R(lx, ly, 2, 2, skin);
  const fast = arms === 'fast';
  const tp = Math.floor(t * (fast ? 16 : 9));
  if (side) {
    if (arms === 'rest' || moving) {
      R(7 + (moving ? -swing : 0), 12 + dy, 2, 6, shirtL);
      hand(7 + (moving ? -swing : 0), 18 + dy);
    } else {
      R(7, 12, 2, 4, shirtL);
      hand(6, 15);
    }
  } else if (arms === 'type' || arms === 'fast') {
    R(2, 12, 2, 4, shirt);
    R(12, 12, 2, 4, shirt);
    hand(2, 16 + (tp % 2));
    hand(12, 16 + ((tp + 1) % 2));
  } else if (arms === 'read') {
    R(2, 12, 2, 4, shirt);
    R(12, 12, 2, 4, shirt);
    const page = Math.floor(t * 0.7) % 2;
    R(4, 12, 8, 6, '#f3efe4');
    R(4, 12, 8, 1, '#c9c2b0');
    R(page ? 7 : 8, 12, 1, 6, '#c9c2b0');
    R(5, 14, page ? 2 : 3, 1, '#8c8570');
    R(9, 15, 2, 1, '#8c8570');
    hand(3, 16);
    hand(11, 16);
  } else if (arms === 'chin') {
    R(2, 12 + dy, 2, 6, shirt);
    hand(2, 18 + dy);
    R(12, 12, 2, 3, shirt);
    R(10, 10, 4, 2, shirt);
    hand(9, 9);
  } else if (arms === 'cup') {
    R(2, 12 + dy, 2, 6, shirt);
    hand(2, 18 + dy);
    R(12, 12, 2, 3, shirt);
    R(10, 10, 4, 2, shirt);
    hand(9, 9);
    R(8, 8, 3, 3, '#f5f1e8');
    R(8, 8, 3, 1, '#7a4a2a');
  } else if (arms === 'raise' || arms === 'ask') {
    R(2, 12 + dy, 2, 6, shirt);
    hand(2, 18 + dy);
    const wave = arms === 'raise' ? Math.round(Math.sin(t * 7)) : 0;
    R(12, 6, 2, 7, shirt);
    hand(12 + wave, 3);
  } else if (arms === 'search') {
    R(2, 12 + dy, 2, 6, shirt);
    hand(2, 18 + dy);
    R(12, 8, 2, 5, shirt);
    hand(12, 6);
    const ox2 = Math.round(Math.sin(t * 3));
    R(13 + ox2, 2, 4, 4, '#cfe9ff');
    R(13 + ox2, 2, 4, 1, '#2b2f40');
    R(13 + ox2, 5, 4, 1, '#2b2f40');
    R(13 + ox2, 2, 1, 4, '#2b2f40');
    R(16 + ox2, 2, 1, 4, '#2b2f40');
    R(15 + ox2, 6, 1, 3, '#2b2f40');
  } else if (arms === 'cross') {
    R(3, 13, 10, 2, shirtL);
    hand(2, 13);
    hand(12, 13);
  } else if (arms === 'sleep') {
    R(2, 14, 2, 4, shirt);
    R(12, 14, 2, 4, shirt);
  } else {
    // rest / walking
    const a = swing;
    R(2, 12 + dy - a, 2, 6, shirt);
    R(12, 12 + dy + a, 2, 6, shirt);
    hand(2, 18 + dy - a);
    hand(12, 18 + dy + a);
  }

  // ---- head ----------------------------------------------------------------
  const hy = (arms === 'sleep' ? 3 : 0) + dy;
  const tilt = arms === 'chin' ? Math.round(Math.sin(t * 1.2)) : 0;
  const hx = tilt;
  if (side) {
    R(4 + hx, 3 + hy, 8, 8, skin);
    R(4 + hx, 10 + hy, 8, 1, skinD);
    if (!back) R(3 + hx, 8 + hy, 1, 1, skin); // nose
  } else {
    R(4 + hx, 3 + hy, 8, 8, skin);
    R(4 + hx, 10 + hy, 8, 1, skinD);
  }

  // face
  const eye = '#2a2433';
  if (!back) {
    const closed = blink || arms === 'sleep';
    if (side) {
      R(5 + hx, closed ? 8 + hy : 7 + hy, 1, closed ? 1 : 2, eye);
      if (!closed) R(5 + hx, 7 + hy, 1, 1, '#ffffff');
      R(5 + hx, 10 + hy, 2, 1, mix(skin, '#c2553f', 0.5));
    } else {
      if (closed) {
        R(5 + hx, 8 + hy, 2, 1, eye);
        R(9 + hx, 8 + hy, 2, 1, eye);
      } else {
        R(5 + hx, 7 + hy, 2, 2, eye);
        R(9 + hx, 7 + hy, 2, 2, eye);
        R(5 + hx, 7 + hy, 1, 1, '#ffffff');
        R(9 + hx, 7 + hy, 1, 1, '#ffffff');
      }
      R(7 + hx, 10 + hy, 2, 1, mix(skin, '#c2553f', 0.55));
      R(4 + hx, 9 + hy, 1, 1, mix(skin, '#ff8a80', 0.35));
      R(11 + hx, 9 + hy, 1, 1, mix(skin, '#ff8a80', 0.35));
    }
  }

  // accessories on the face (under the hair)
  if (!back && acc === 'glasses') {
    if (side) {
      R(4 + hx, 7 + hy, 3, 3, 'rgba(180,215,255,0.55)');
      R(4 + hx, 7 + hy, 3, 1, OUTLINE);
      R(4 + hx, 9 + hy, 3, 1, OUTLINE);
      R(6 + hx, 7 + hy, 1, 3, OUTLINE);
      R(7 + hx, 7 + hy, 4, 1, OUTLINE);
    } else {
      R(4 + hx, 7 + hy, 4, 3, 'rgba(180,215,255,0.55)');
      R(8 + hx, 7 + hy, 4, 3, 'rgba(180,215,255,0.55)');
      R(4 + hx, 6 + hy, 8, 1, OUTLINE);
      R(4 + hx, 9 + hy, 4, 1, OUTLINE);
      R(8 + hx, 9 + hy, 4, 1, OUTLINE);
      R(4 + hx, 6 + hy, 1, 4, OUTLINE);
      R(7 + hx, 6 + hy, 2, 4, OUTLINE);
      R(11 + hx, 6 + hy, 1, 4, OUTLINE);
      if (!blink && arms !== 'sleep') {
        R(5 + hx, 7 + hy, 2, 2, eye);
        R(9 + hx, 7 + hy, 2, 2, eye);
      }
    }
  }
  if (!back && acc === 'beard') {
    const beard = mix(hair, '#7a6a5a', 0.35);
    if (side) R(4 + hx, 9 + hy, 5, 2, beard);
    else {
      R(4 + hx, 9 + hy, 8, 2, beard);
      R(7 + hx, 10 + hy, 2, 1, mix(skin, '#c2553f', 0.55));
      R(4 + hx, 8 + hy, 1, 1, beard);
      R(11 + hx, 8 + hy, 1, 1, beard);
    }
  }
  if (acc === 'earrings') {
    if (side) R(8 + hx, 9 + hy, 1, 2, '#f2c94c');
    else {
      R(3 + hx, 9 + hy, 1, 2, '#f2c94c');
      R(12 + hx, 9 + hy, 1, 2, '#f2c94c');
    }
  }

  // hair
  drawHair(R, style, { back, side, hx, hy, hair, hairD, hairL, shirt, acc });

  if (acc === 'headset') {
    const hs = '#2b2f40';
    if (side) {
      R(8 + hx, 2 + hy, 1, 7, hs);
      R(8 + hx, 6 + hy, 3, 4, '#3a4054');
      R(5 + hx, 10 + hy, 3, 1, hs);
    } else {
      R(3 + hx, 3 + hy, 10, 1, hs);
      R(2 + hx, 6 + hy, 2, 4, '#3a4054');
      R(12 + hx, 6 + hy, 2, 4, '#3a4054');
      if (!back) R(4 + hx, 10 + hy, 4, 1, hs);
    }
  }

  if (alpha !== 1) ctx.globalAlpha = prevAlpha;
}

function drawHair(R, style, k) {
  const { back, side, hx, hy, hair, hairD, hairL, shirt } = k;
  const X = (n) => n + hx;
  const Y = (n) => n + hy;

  if (style === 'bald') {
    R(X(5), Y(3), 4, 1, mix('#ffffff', hair, 0.1));
    return;
  }

  if (back) {
    // seen from behind the hair covers the whole head
    R(X(3), Y(1), 10, 9, hair);
    R(X(4), Y(1), 8, 1, hairL);
    R(X(3), Y(7), 10, 2, hairD);
    if (style === 'long') R(X(3), Y(9), 10, 4, hair);
    if (style === 'bob') R(X(3), Y(9), 10, 1, hair);
    if (style === 'bun') R(X(6), Y(-1), 4, 3, hair);
    if (style === 'cap') {
      R(X(3), Y(1), 10, 5, shade(shirt, -10));
      R(X(3), Y(1), 10, 1, shade(shirt, 18));
    }
    if (style === 'spiky') [4, 6, 8, 10].forEach((n) => R(X(n), Y(0), 1, 2, hair));
    return;
  }

  if (side) {
    // facing left: hair is on the right (back of the head) and on top
    R(X(4), Y(1), 8, 3, hair);
    R(X(8), Y(3), 4, 6, hair);
    R(X(5), Y(1), 5, 1, hairL);
    if (style === 'long') R(X(8), Y(9), 4, 5, hair);
    if (style === 'bob') R(X(8), Y(9), 4, 2, hair);
    if (style === 'bun') R(X(9), Y(-1), 3, 3, hair);
    if (style === 'spiky') [5, 7, 9].forEach((n) => R(X(n), Y(0), 1, 2, hair));
    if (style === 'curly') {
      R(X(3), Y(1), 10, 4, hair);
      R(X(8), Y(5), 4, 4, hair);
    }
    if (style === 'cap') {
      R(X(4), Y(1), 8, 3, shade(shirt, -10));
      R(X(2), Y(4), 5, 1, shade(shirt, -30));
      R(X(4), Y(1), 8, 1, shade(shirt, 18));
    }
    return;
  }

  // front
  switch (style) {
    case 'long':
      R(X(4), Y(1), 8, 3, hair);
      R(X(3), Y(2), 1, 10, hair);
      R(X(12), Y(2), 1, 10, hair);
      R(X(3), Y(1), 10, 1, hairD);
      R(X(5), Y(1), 4, 1, hairL);
      R(X(4), Y(3), 3, 1, hairD);
      break;
    case 'bob':
      R(X(4), Y(1), 8, 3, hair);
      R(X(3), Y(2), 1, 8, hair);
      R(X(12), Y(2), 1, 8, hair);
      R(X(5), Y(1), 4, 1, hairL);
      R(X(4), Y(3), 4, 1, hairD);
      break;
    case 'bun':
      R(X(4), Y(1), 8, 3, hair);
      R(X(3), Y(2), 1, 4, hair);
      R(X(12), Y(2), 1, 4, hair);
      R(X(6), Y(-1), 4, 3, hair);
      R(X(6), Y(-1), 4, 1, hairL);
      break;
    case 'spiky':
      R(X(4), Y(1), 8, 3, hair);
      R(X(3), Y(2), 1, 3, hair);
      R(X(12), Y(2), 1, 3, hair);
      [4, 6, 8, 10].forEach((n) => R(X(n), Y(0), 1, 2, hair));
      R(X(5), Y(1), 3, 1, hairL);
      break;
    case 'curly':
      R(X(3), Y(1), 10, 3, hair);
      R(X(2), Y(2), 2, 5, hair);
      R(X(12), Y(2), 2, 5, hair);
      R(X(4), Y(0), 2, 1, hair);
      R(X(8), Y(0), 3, 1, hair);
      R(X(5), Y(1), 3, 1, hairL);
      break;
    case 'cap':
      R(X(3), Y(1), 10, 3, shade(shirt, -10));
      R(X(4), Y(0), 8, 1, shade(shirt, -10));
      R(X(3), Y(4), 10, 1, shade(shirt, -34));
      R(X(4), Y(1), 8, 1, shade(shirt, 18));
      R(X(3), Y(4), 1, 2, hair);
      R(X(12), Y(4), 1, 2, hair);
      break;
    default: // short
      R(X(4), Y(1), 8, 3, hair);
      R(X(3), Y(2), 1, 4, hair);
      R(X(12), Y(2), 1, 4, hair);
      R(X(5), Y(1), 4, 1, hairL);
      R(X(4), Y(3), 2, 1, hairD);
      R(X(10), Y(3), 2, 1, hairD);
  }
}
