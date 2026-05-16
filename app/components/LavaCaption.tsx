"use client";

import { useEffect, useState } from "react";

const LAVA_GIST_RAW =
  "https://gist.githubusercontent.com/Jada-Q/d674be530b9a9a061c76b118d6284939/raw/lava-init.md";

export default function LavaCaption() {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const today = new Date().toISOString().slice(0, 10);
    fetch(`${LAVA_GIST_RAW}?t=${today}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.text() : Promise.reject(r.status)))
      .then((body) => {
        if (cancelled) return;
        const trimmed = body.trim();
        if (trimmed && !trimmed.startsWith("🪨 Lava — initializing")) {
          setText(trimmed);
        }
      })
      .catch(() => {
        // silent: if gist unreachable, just hide the caption
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!text) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-32 left-1/2 z-10 hidden -translate-x-1/2 select-none px-4 text-center font-serif text-white md:block lg:bottom-40"
      style={{ textShadow: "0 1px 4px rgba(0,0,0,0.55)" }}
    >
      <div className="mb-1 text-[10px] uppercase tracking-[0.25em] opacity-45">
        from the core
      </div>
      <div className="max-w-[420px] whitespace-pre-wrap text-[12px] italic leading-relaxed opacity-70">
        {text}
      </div>
    </div>
  );
}
