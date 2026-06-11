import Scene from "./components/Scene";
import RegionSwitcher from "./components/RegionSwitcher";
import LavaCaption from "./components/LavaCaption";
import { resolveRegion, type UrlParams } from "@/lib/regions";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const raw = await searchParams;
  const params: UrlParams = {
    r: pickString(raw.r),
  };
  const region = resolveRegion(params);
  const activeKey = params.r?.toLowerCase() ?? "world";

  const minRaw = pickString(raw.min);
  const minParsed = minRaw !== undefined ? Number(minRaw) : NaN;
  const minMag =
    Number.isFinite(minParsed) && minParsed >= 0 ? minParsed : 2.5;

  // Theme: toon (default, WebGL) vs dark (legacy 2D canvas). Anything that
  // isn't exactly "dark" falls through to toon.
  const theme: "toon" | "dark" =
    pickString(raw.theme) === "dark" ? "dark" : "toon";
  const embed = pickString(raw.embed) === "app";
  const intro = theme === "toon" && !embed && pickString(raw.intro) !== "0";

  return (
    <main
      data-theme={theme}
      className="relative h-screen w-screen overflow-hidden"
    >
      <Scene
        region={region}
        minMag={minMag}
        theme={theme}
        embed={embed}
        intro={intro}
      />
      <RegionSwitcher active={activeKey} theme={theme} />
      <LavaCaption theme={theme} />
    </main>
  );
}

function pickString(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}
