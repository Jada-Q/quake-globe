"use client";

// The BEGIN button — the ONLY element on the entire page allowed to use the
// golden accent (#e8ab3c). Its pull depends on everything else staying cool
// and neutral; do not reuse this color anywhere.

export default function IntroOverlay({ onBegin }: { onBegin: () => void }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[12%] z-40 flex justify-center">
      <button
        type="button"
        onClick={onBegin}
        autoFocus
        className="pointer-events-auto select-none rounded-[4px] border-2 border-[#22302c] bg-[#e8ab3c] px-8 py-2.5 font-mono text-sm font-bold uppercase tracking-[0.3em] text-[#22302c] shadow-[0_5px_0_rgba(34,48,44,0.55)] transition-transform duration-150 hover:scale-105 active:translate-y-1 active:shadow-[0_2px_0_rgba(34,48,44,0.55)] md:text-base"
      >
        Begin
      </button>
    </div>
  );
}
