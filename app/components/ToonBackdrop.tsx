// CSS-only backdrop for the toon theme: flat mint, a faint same-hue swirl
// hint top-left, and sparse pale "sea foam" dots. Zero GPU cost — the WebGL
// canvas renders with alpha on top of this.

import { MINT_BG } from "@/lib/three/palette";

export default function ToonBackdrop() {
  return (
    // z-0 (not negative): body's own background paints ABOVE negative
    // z-index descendants, so -z-10 here would be swallowed by bg-black.
    // DOM order keeps the canvas (rendered after) on top.
    <div
      aria-hidden
      className="fixed inset-0 z-0"
      style={{
        backgroundColor: MINT_BG,
        backgroundImage: [
          // faint swirl hint, top-left, same hue slightly lighter
          "radial-gradient(ellipse 42% 30% at 18% 12%, rgba(255,255,255,0.10), transparent 70%)",
          "radial-gradient(ellipse 30% 22% at 30% 22%, rgba(255,255,255,0.06), transparent 70%)",
          // sparse foam dots — two offset grids of tiny pale specks
          "radial-gradient(rgba(255,255,255,0.16) 1.2px, transparent 1.6px)",
          "radial-gradient(rgba(255,255,255,0.10) 1px, transparent 1.4px)",
        ].join(", "),
        backgroundSize: "100% 100%, 100% 100%, 220px 220px, 140px 140px",
        backgroundPosition: "0 0, 0 0, 0 0, 70px 90px",
      }}
    />
  );
}
