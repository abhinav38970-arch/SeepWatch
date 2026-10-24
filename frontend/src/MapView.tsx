import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import type { Bundle } from "./types";

function reachColor(
  forecastLoss: number | null | undefined,
  excess: number | null | undefined,
  status: string
): string {
  if (status === "no_forecast" || status === "flood_no_forecast") return "#475569";
  const loss = forecastLoss ?? 0;
  const ex = excess ?? 0;
  const heat = -loss + Math.max(0, ex);
  if (heat > 120) return "#f07178";
  if (heat > 60) return "#f0b429";
  if (heat > 20) return "#3dd6c6";
  if (loss > 10) return "#6bcb8b";
  return "#3dd6c6";
}

function shortfallColor(p50: number): string {
  if (p50 > 20) return "#f07178";
  if (p50 > 5) return "#c084fc";
  if (p50 < -5) return "#6bcb8b";
  return "#94a3b8";
}

type Props = {
  bundle: Bundle;
  shortfallByNode: Map<string, Bundle["nodes_shortfall"][0]>;
  selected: string | null;
  onSelectReach: (id: string) => void;
  onSelectNode: (id: string) => void;
};

export default function MapView({
  bundle,
  shortfallByNode,
  onSelectReach,
  onSelectNode,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const reachCb = useRef(onSelectReach);
  const nodeCb = useRef(onSelectNode);
  reachCb.current = onSelectReach;
  nodeCb.current = onSelectNode;

  // Create map once
  useEffect(() => {
    if (!ref.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: ref.current,
      style: {
        version: 8,
        // glyphs required if we ever add symbol layers; keep for safety
        glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap",
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
      center: [-120.35, 36.9],
      zoom: 8.2,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;

    map.on("click", "reaches-line", (e) => {
      const id = e.features?.[0]?.properties?.id;
      if (id) reachCb.current(String(id));
    });
    map.on("mouseenter", "reaches-line", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "reaches-line", () => {
      map.getCanvas().style.cursor = "";
    });

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update reach lines + node markers when data changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      const colorById = Object.fromEntries(
        bundle.reach_colors.map((r) => [
          r.id,
          reachColor(r.forecast_loss_cfs, r.excess_loss_cfs, r.status),
        ])
      );

      const reachFeatures = bundle.geometry.reaches
        .filter((r) => Array.isArray(r.coordinates) && r.coordinates.length >= 2)
        .map((r) => ({
          type: "Feature" as const,
          properties: {
            id: r.id,
            name: r.name,
            color: colorById[r.id] ?? "#64748b",
            label: r.label,
          },
          geometry: {
            type: "LineString" as const,
            coordinates: r.coordinates,
          },
        }));

      const fc = { type: "FeatureCollection" as const, features: reachFeatures };
      const existing = map.getSource("reaches") as maplibregl.GeoJSONSource | undefined;
      if (existing) {
        existing.setData(fc);
      } else {
        map.addSource("reaches", { type: "geojson", data: fc });
        map.addLayer({
          id: "reaches-line",
          type: "line",
          source: "reaches",
          paint: {
            "line-color": ["get", "color"],
            "line-width": 5,
            "line-opacity": 0.95,
          },
        });
      }

      // HTML markers avoid glyph/symbol-layer validation errors
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      for (const n of bundle.geometry.nodes) {
        const s = shortfallByNode.get(n.id);
        const color = s ? shortfallColor(s.shortfall_p50) : "#94a3b8";
        const el = document.createElement("button");
        el.type = "button";
        el.className = "map-node";
        el.textContent = n.id;
        el.style.cssText = [
          `background:${color}`,
          "color:#0b1220",
          "border:2px solid #0b1220",
          "border-radius:999px",
          "padding:2px 7px",
          "font:700 11px/1.2 IBM Plex Sans, system-ui, sans-serif",
          "cursor:pointer",
          "box-shadow:0 1px 4px rgba(0,0,0,0.35)",
        ].join(";");
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          nodeCb.current(n.id);
        });
        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([n.lon, n.lat])
          .addTo(map);
        markersRef.current.push(marker);
      }
    };

    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [bundle, shortfallByNode]);

  return <div id="map" ref={ref} />;
}
