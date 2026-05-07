"use client";

import { useEffect, useState } from "react";
import type { Region } from "@/lib/regions";
import type { Quake } from "@/lib/usgs";

export default function Overlay({
  region,
  minMag,
  count,
  largest,
}: {
  region: Region;
  minMag: number;
  count: number;
  largest: Quake | null;
}) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!now) return null;

  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: region.timezone,
  }).format(now);
  const utc = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(now);
  const dateStr = new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: region.timezone,
  }).format(now);
  const tzAbbr = getTzAbbr(now, region.timezone);

  return (
    <div
      className="pointer-events-none fixed inset-0 z-10 select-none text-white"
      style={{ textShadow: "0 1px 4px rgba(0,0,0,0.55)" }}
    >
      <div className="absolute left-6 top-6 font-serif tracking-wide md:left-10 md:top-10">
        <div className="text-xs uppercase tracking-[0.3em] opacity-60">
          Quake Globe
        </div>
        <div className="mt-2 text-xs opacity-70">
          {region.label} · {region.caption}
        </div>
        <div className="mt-3 whitespace-nowrap text-[11px] italic opacity-45">
          — also Tide Pixels · Sky Traffic · Bay Ships · Subway Pulse
        </div>
      </div>

      <div className="absolute right-6 top-6 text-right font-serif md:right-10 md:top-10">
        <div className="font-mono text-3xl tracking-tight md:text-4xl">
          {time}
        </div>
        <div className="mt-1 text-xs opacity-70">
          {dateStr} {tzAbbr}
        </div>
        <div className="mt-0.5 font-mono text-[11px] opacity-50">
          {utc} UTC
        </div>
      </div>

      <div className="absolute bottom-6 left-6 font-serif md:bottom-10 md:left-10">
        <div className="text-[10px] uppercase tracking-[0.25em] opacity-50">
          Events last 24h
        </div>
        <div className="mt-0.5 font-mono text-2xl tracking-tight">
          {count.toString().padStart(3, "0")} <span className="text-xs opacity-60">visible (M ≥ {minMag})</span>
        </div>
        {largest ? (
          <div className="mt-1 text-[11px] opacity-65">
            largest M{largest.mag.toFixed(1)} — {largest.place || "—"}
          </div>
        ) : (
          <div className="mt-1 text-[11px] opacity-50">no events in window</div>
        )}
        <div className="mt-1 text-[11px] opacity-50">
          data: USGS · 60s polling · ~1–15 min lag
        </div>
      </div>

      <div className="absolute bottom-10 right-10 hidden max-w-[280px] text-right font-serif text-xs italic opacity-50 md:block">
        データ: USGS Earthquake Hazards Program.<br />
        リング寿命 90 秒。色 = マグニチュード。
      </div>
    </div>
  );
}

function getTzAbbr(date: Date, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "short",
    }).formatToParts(date);
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}
