import type { PageView } from "../../api/types";

/* The dark page viewer. Highlights are divs positioned with percentages from
   the normalized bboxes, so no PDF renderer is needed. Lemon is used here
   and only here: it always means "this came from here". */
export function LightTable({
  page,
  hovered,
  onHover,
}: {
  page: PageView;
  hovered: number[];
  onHover: (regionIds: number[]) => void;
}) {
  return (
    <div className="rounded-lg bg-lighttable p-4">
      <div className="relative">
        <img
          src={page.image_url}
          alt={`page ${page.page_num}`}
          className="w-full rounded-sm"
          draggable={false}
        />
        {page.regions.map((region) => {
          const [x1, y1, x2, y2] = region.bbox;
          const active = hovered.includes(region.region_id);
          return (
            <div
              key={region.region_id}
              onMouseEnter={() => onHover([region.region_id])}
              onMouseLeave={() => onHover([])}
              style={{
                left: `${x1 * 100}%`,
                top: `${y1 * 100}%`,
                width: `${(x2 - x1) * 100}%`,
                height: `${(y2 - y1) * 100}%`,
              }}
              className={`absolute cursor-crosshair rounded-xs transition ${
                active
                  ? "bg-provenance/25 ring-2 ring-provenance"
                  : "hover:bg-provenance/15 hover:ring-1 hover:ring-provenance/60"
              }`}
            >
              {active && (
                <span className="absolute -top-5 left-0 rounded-sm bg-provenance px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap text-black">
                  {region.region_type} · {region.region_id}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
