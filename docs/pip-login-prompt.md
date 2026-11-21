# Pip Login — Build Prompt Reference
<!-- Archived reference for future login screen design integration in Relief Assist -->

Source: Uberdesigner prompt format v1 · pip-login · v1.0.0

## Goal Summary
One motion piece: **a sign-in card with a little robot companion (Pip)**, a 14-second seamless loop on a 1080 × 1080 stage that a visitor can take over and type into.
- Warm light-grey page (`#E6E4DF`) with soft radial glow.
- Zoomed 1.18× about (540, 560) and raised 20px.
- **Card:** 680 × 388 at (200, 430), `#FBFAF8`, 32px rounded corners, faint rim, 44px padding.
- **Robot (Pip):** 200 × 172 rounded head, dark bezel, black LED-matrix screen (19 × 14 dots, 8px pitch, canvas render + blurred glow layer), antennas, ears with indicator lights, hands resting on card edge.
- **Reactions:**
  - Reading along with input (gaze hop on key).
  - Cross eyes + head shake + red glow + field shake if invalid/domain missing.
  - Shy hands covering eyes when password field focused, peeking with one eye.
  - Star eyes + green glow on hover.
  - Loading spinner eyes on check.
  - Heart eyes + squash-and-stretch celebration jump on success.

## Complete Spec Archived

### 1. `src/styles/tokens.css`
```css
:root {
  --page: #e6e4df;
  --stage: 1080px;
  --stage-glow: radial-gradient(ellipse at 50% 40%, #efeee9 0%, #e3e1db 70%, #dad7d0 100%);
  --scene-zoom: translateY(-20px) scale(1.18);

  --font: Geist, sans-serif;
  --mono: "Geist Mono", monospace;

  --ink: #151515;
  --muted: #8a877f;
  --placeholder: #9a978f;
  --white: #fff;
  --error: #d93f44;

  --card: #fbfaf8;
  --card-rim: rgba(0, 0, 0, 0.06);
  --card-radius: 32px;
  --card-pad: 44px;
  --cap-size: 12px;
  --cap-tracking: 1px;
  --title-size: 40px;
  --title-weight: 500;
  --title-tracking: -1.2px;

  --field-h: 56px;
  --field-fill: #f1efeb;
  --field-rim: rgba(0, 0, 0, 0.08);
  --field-size: 17px;
  --label-w: 96px;
  --label-size: 14px;
  --dots-size: 20px;
  --dots-tracking: 4px;
  --caret-w: 2px;
  --caret-h: 22px;
  --button: #151515;

  --pip-green: #8ff0c2;
  --led-dark: #0a0a0b;
}
```

### 2. `src/content.ts`
```ts
export const TEXT = {
  cap: "Quiet spaces",
  title: "Welcome back",
  email: "Email",
  password: "Password",
  e1: "mila@quelm",
  e2: ".so",
  error: "Add the domain",
  signIn: "Sign in",
  checking: "Checking",
  welcome: "Welcome back, Mila",
  scene:
    "A sign-in card, Quiet spaces, Welcome back, with a small white robot called Pip peeking over its top edge. " +
    "His LED eyes read along as an email is typed, cross out and shake no when the domain is missing, look away " +
    "behind his hands while the password is typed, turn to stars over Sign in, spin while checking and become " +
    "hearts when he says Welcome back, Mila.",
};

export const GAZE_CHARS = 13;
```

### 3. Math & Animation Helpers (`src/lib/math.ts`)
```ts
export const TAU = Math.PI * 2;
export const cl = (v: number) => Math.min(1, Math.max(0, v));
export const L = (a: number, b: number, k: number) => a + (b - a) * k;
export const sm = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
export const eio = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const hash = (i: number) => {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
```

### 4. LED Matrix Driver (`src/lib/led.ts`)
- 19 × 14 canvas matrix with dual context (sharp + blurred glow).
- Expression bitmaps (`idle`, `blink`, `read`, `star`, `heart`, `happy`, `sleepy`, `shy`, `cross`, `load`).
- Dot-by-dot staggered cross-fading via `drawLED()`.

### 5. Timeline Script (`src/lib/timeline.ts`)
- 14-second looping keyframes.
- Bowed Bezier cursor sweeps.
- Physics-based head bob, hop, nod, and antenna lag calculations.

### 6. Interactive Live Mode (`src/lib/live.ts`)
- Smooth handover from autoplay to user control on pointermove.
- Realtime gaze tracking to pointer.
- Spring physics hands transition via `transform .35s cubic-bezier(.3,1.2,.4,1)`.
