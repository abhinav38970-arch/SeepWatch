import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import type { Bundle } from "./types";

function reachColor(
  forecastLoss: number | null | undefined,
  excess: number | null | undefined,
  status: string
): string {
  if (status === "no_forecast" || status === "flood_no_forecast") return "#475569";
  // Color by forecast loss magnitude (more negative = hotter). Excess amplifies.
  const loss = forecastLoss ?? 0;
  const ex = excess ?? 0;
  const heat = -loss + Math.max(0, ex);
  if (heat > 120) return "#f07178";
  if (heat > 60) return "#f0b429";
  if (heat > 20) return "#3dd6c6";
  if (loss > 10) return "#6bcb8b"; // forecast gain / recovery
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

export default function MapView({ bundle, shortfallByNode, onSelectReach, onSelectNode }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!ref.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: ref.current,
      style: {
        version: 8,
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

    map.on("load", () => {
      const colorById = Object.fromEntries(
        bundle.reach_colors.map((r) => [
          r.id,
          reachColor(r.forecast_loss_cfs, r.excess_loss_cfs, r.status),
        ])
      );

      const reachFeatures = bundle.geometry.reaches.map((r) => ({
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

      map.addSource("reaches", {
        type: "geojson",
        data: { type: "FeatureCollection", features: reachFeatures },
      });
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

      const nodeFeatures = bundle.geometry.nodes.map((n) => {
        const s = shortfallByNode.get(n.id);
        return {
          type: "Feature" as const,
          properties: {
            id: n.id,
            name: n.name,
            color: s ? shortfallColor(s.shortfall_p50) : "#94a3b8",
            shortfall: s ? s.shortfall_p50 : 0,
          },
          geometry: { type: "Point" as const, coordinates: [n.lon, n.lat] },
        };
      });

      map.addSource("nodes", {
        type: "geojson",
        data: { type: "FeatureCollection", features: nodeFeatures },
      });
      map.addLayer({
        id: "nodes-circle",
        type: "circle",
        source: "nodes",
        paint: {
          "circle-radius": 8,
          "circle-color": ["get", "color"],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#0b1220",
        },
      });
      map.addLayer({
        id: "nodes-label",
        type: "symbol",
        source: "nodes",
        layout: {
          "text-field": ["get", "id"],
          "text-size": 11,
          "text-offset": [0, 1.2],
        },
        paint: { "text-color": "#e8eefc", "text-halo-color": "#0b1220", "text-halo-width": 1.2 },
      });

      map.on("click", "reaches-line", (e) => {
        const id = e.features?.[0]?.properties?.id;
        if (id) onSelectReach(String(id));
      });
      map.on("click", "nodes-circle", (e) => {
        const id = e.features?.[0]?.properties?.id;
        if (id) onSelectNode(String(id));
      });
      map.on("mouseenter", "reaches-line", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "reaches-line", () => { map.getCanvas().style.cursor = ""; });
      map.on("mouseenter", "nodes-circle", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "nodes-circle", () => { map.getCanvas().style.cursor = ""; });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [bundle, shortfallByNode, onSelectReach, onSelectNode]);

  return <div id="map" ref={ref} />;
}
