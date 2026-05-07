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

  const onStatsChange = useCallback(
    (s: { visibleCount: number; largest: Quake | null }) => {
      setCount(s.visibleCount);
      setLargest(s.largest);
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
      />
    </>
  );
}
