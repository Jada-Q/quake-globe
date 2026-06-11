"use client";

import { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import QuakeCanvas from "./QuakeCanvas";
import Overlay from "./Overlay";
import type { Region } from "@/lib/regions";
import type { Quake } from "@/lib/usgs";
import type { QuakeStats } from "@/lib/use-quakes";

// The WebGL toon renderer (three.js) loads only on the toon path — the dark
// theme keeps its 2D-canvas bundle untouched, with zero three.js bytes.
const ToonGlobe = dynamic(() => import("./ToonGlobe"), { ssr: false });

export default function Scene({
  region,
  minMag,
  theme,
  embed,
  intro,
}: {
  region: Region;
  minMag: number;
  theme: "toon" | "dark";
  embed: boolean;
  intro: boolean;
}) {
  const [count, setCount] = useState(0);
  const [largest, setLargest] = useState<Quake | null>(null);
  const [source, setSource] = useState<"usgs" | "p2p">("usgs");
  const [fallbackFromP2P, setFallbackFromP2P] = useState(false);
  const [stale, setStale] = useState(false);
  const [staleSince, setStaleSince] = useState<number | null>(null);

  const onStatsChange = useCallback((s: QuakeStats) => {
    setCount(s.visibleCount);
    setLargest(s.largest);
    setSource(s.source);
    setFallbackFromP2P(s.fallbackFromP2P);
    setStale(s.stale);
    setStaleSince(s.staleSince);
  }, []);

  return (
    <>
      {theme === "dark" ? (
        <QuakeCanvas
          region={region}
          minMag={minMag}
          onStatsChange={onStatsChange}
        />
      ) : (
        <ToonGlobe
          region={region}
          minMag={minMag}
          embed={embed}
          intro={intro}
          onStatsChange={onStatsChange}
        />
      )}
      <Overlay
        theme={theme}
        region={region}
        minMag={minMag}
        count={count}
        largest={largest}
        source={source}
        fallbackFromP2P={fallbackFromP2P}
        stale={stale}
        staleSince={staleSince}
      />
    </>
  );
}
