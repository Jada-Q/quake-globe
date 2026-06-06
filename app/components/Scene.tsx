"use client";

import { useCallback, useState } from "react";
import QuakeCanvas from "./QuakeCanvas";
import Overlay from "./Overlay";
import type { Region } from "@/lib/regions";
import type { Quake } from "@/lib/usgs";

export default function Scene({
  region,
  minMag,
}: {
  region: Region;
  minMag: number;
}) {
  const [count, setCount] = useState(0);
  const [largest, setLargest] = useState<Quake | null>(null);
  const [source, setSource] = useState<"usgs" | "p2p">("usgs");
  const [fallbackFromP2P, setFallbackFromP2P] = useState(false);
  const [stale, setStale] = useState(false);
  const [staleSince, setStaleSince] = useState<number | null>(null);

  const onStatsChange = useCallback(
    (s: {
      visibleCount: number;
      largest: Quake | null;
      source: "usgs" | "p2p";
      fallbackFromP2P: boolean;
      stale: boolean;
      staleSince: number | null;
    }) => {
      setCount(s.visibleCount);
      setLargest(s.largest);
      setSource(s.source);
      setFallbackFromP2P(s.fallbackFromP2P);
      setStale(s.stale);
      setStaleSince(s.staleSince);
    },
    [],
  );

  return (
    <>
      <QuakeCanvas
        region={region}
        minMag={minMag}
        onStatsChange={onStatsChange}
      />
      <Overlay
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
