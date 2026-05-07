import Scene from "./components/Scene";
import RegionSwitcher from "./components/RegionSwitcher";
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

  return (
    <main className="relative h-screen w-screen overflow-hidden">
      <Scene region={region} minMag={minMag} />
      <RegionSwitcher active={activeKey} />
    </main>
  );
}

function pickString(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}
