const FACES = ['400 20px "Geist"', '500 20px "Geist"', '500 16px "Geist Mono"'];
const WAIT_AT_MOST = 1500;

export function fontsIn(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return Promise.resolve();
  return Promise.race([
    Promise.all(FACES.map((face) => document.fonts.load(face))),
    new Promise((done) => setTimeout(done, WAIT_AT_MOST)),
  ]).then(
    () => undefined,
    () => undefined,
  );
}
