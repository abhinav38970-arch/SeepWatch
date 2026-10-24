import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import type { Bundle } from "./types";

const GALLONS_PER_CFS_DAY = 646_317;

/** Traffic-light color palette for immediate visual clarity */
const REACH_TRAFFIC_COLOR: Record<string, string> = {
  R2A: "#ef4444", // Bright Red — Major Leak!
  R1: "#f97316", // Bright Orange — Moderate Seepage
  R4A: "#eab308", // Warm Yellow — Minor Watch Area
  R2B3: "#22c55e", // Bright Green — Healthy Canal (No Leak)
};

function reachColor(
  id: string,
  excess: number | null | undefined,
  status: string
): string {
  if (REACH_TRAFFIC_COLOR[id]) return REACH_TRAFFIC_COLOR[id];
  if (status === "flagged") return "#ef4444";
  if (status === "no_forecast" || status === "flood_no_forecast") return "#eab308";
  const ex = excess ?? 0;
  if (ex > 25) return "#ef4444";
  if (ex > 0) return "#f97316";
  return "#22c55e";
}

function cfsToMillionsGallons(cfs: number | null | undefined, fallbackM: number): number {
  if (cfs == null || Number.isNaN(cfs)) return fallbackM;
  const m = Math.round((Math.abs(cfs) * GALLONS_PER_CFS_DAY) / 1_000_000);
  return m > 0 ? m : fallbackM;
}

function reachPlainBadge(id: string, excessCfs: number | null | undefined): {
  text: string;
  title: string;
  borderColor: string;
  bgColor: string;
  textColor: string;
  isMajorLeak?: boolean;
} {
  const lostM = cfsToMillionsGallons(excessCfs, 48);
  switch (id) {
    case "R2A":
      return {
        text: `🚨 MAJOR LEAK: Madera → Chowchilla (${lostM}M gal/day lost)`,
        title: "Major Leak between Gravelly Ford (Madera) and Chowchilla — click for full leak analysis",
        borderColor: "#ef4444",
        bgColor: "#fef2f2",
        textColor: "#991b1b",
        isMajorLeak: true,
      };
    case "R1":
      return {
        text: "🟠 Moderate Seepage: Friant Dam → Madera",
        title: "Moderate Seepage between Friant Dam and Gravelly Ford (Madera) — click for details",
        borderColor: "#f97316",
        bgColor: "#fff7ed",
        textColor: "#9a3412",
      };
    case "R2B3":
      return {
        text: "🟢 Healthy Canal: Chowchilla → Dos Palos",
        title: "Healthy Canal between Chowchilla and Dos Palos (no unusual leak) — click for details",
        borderColor: "#22c55e",
        bgColor: "#f0fdf4",
        textColor: "#166534",
      };
    case "R4A":
      return {
        text: "🟡 Minor Watch: Dos Palos → Merced",
        title: "Minor Watch Area between Dos Palos and Merced / Washington Rd — click for details",
        borderColor: "#eab308",
        bgColor: "#fefce8",
        textColor: "#854d0e",
      };
    default:
      return {
        text: `Canal Section ${id}`,
        title: "Click for canal leak analysis",
        borderColor: "#64748b",
        bgColor: "#ffffff",
        textColor: "#0f172a",
      };
  }
}

function nodePlainBadge(
  id: string,
  fallbackName: string,
  shortfallP50: number | null | undefined
): {
  text: string;
  title: string;
  borderColor: string;
  bgColor: string;
  textColor: string;
  isAlert?: boolean;
} {
  const shortM = cfsToMillionsGallons(shortfallP50, 31);
  switch (id) {
    case "MIL":
      return {
        text: "💧 Friant Dam (Water Source)",
        title: "Friant Dam / Millerton Lake — Main upstream water release source",
        borderColor: "#0284c7",
        bgColor: "#f0f9ff",
        textColor: "#0c4a6e",
      };
    case "GRF":
      return {
        text: "📍 Gravelly Ford (Madera)",
        title: "Gravelly Ford checkpoint near Madera — click for water delivery details",
        borderColor: "#f97316",
        bgColor: "#fffaf5",
        textColor: "#7c2d12",
      };
    case "SJB":
      return {
        text: `⚠️ Chowchilla Farms (-${shortM}M gal/day short)`,
        title: `Chowchilla Farms delivery checkpoint — ${shortM}M gallons/day projected water shortfall from upstream leak`,
        borderColor: "#ea580c",
        bgColor: "#fff7ed",
        textColor: "#9a3412",
        isAlert: true,
      };
    case "SDP":
      return {
        text: "📍 Dos Palos Farms",
        title: "Dos Palos Farms (Sack Dam checkpoint) — downstream farm delivery area",
        borderColor: "#eab308",
        bgColor: "#fefce8",
        textColor: "#713f12",
      };
    case "SWA":
      return {
        text: "📍 Merced / Washington Rd",
        title: "Merced / Washington Rd downstream checkpoint — click for delivery details",
        borderColor: "#64748b",
        bgColor: "#f8fafc",
        textColor: "#1e293b",
      };
    default:
      return {
        text: `📍 ${fallbackName}`,
        title: `${fallbackName} checkpoint — click for delivery impact`,
        borderColor: "#64748b",
        bgColor: "#f8fafc",
        textColor: "#1e293b",
      };
  }
}

function midpoint(coords: number[][]): [number, number] {
  if (!coords.length) return [-120.35, 36.9];
  const mid = Math.floor(coords.length / 2);
  if (coords.length % 2 === 1) {
    return [coords[mid][0], coords[mid][1]];
  }
  return [
    (coords[mid - 1][0] + coords[mid][0]) / 2,
    (coords[mid - 1][1] + coords[mid][1]) / 2,
  ];
}

/**
 * Builds a smooth stadium/capsule GeoJSON Polygon around a 2-point corridor segment
 * so leak zones and farm impact areas appear as clear geographical buffers on the map.
 */
function buildCorridorZonePolygon(
  start: [number, number],
  end: [number, number],
  radiusDegLat: number,
  stepsPerCap = 24
): number[][][] {
  const midLatRad = (((start[1] + end[1]) / 2) * Math.PI) / 180;
  const cosLat = Math.cos(midLatRad);

  const dx = (end[0] - start[0]) * cosLat;
  const dy = end[1] - start[1];
  const len = Math.hypot(dx, dy) || 1e-6;
  const ux = dx / len;
  const uy = dy / len;
  const baseAngle = Math.atan2(uy, ux);

  const ring: number[][] = [];

  // Semicircle cap around `end` from -90 deg to +90 deg
  for (let i = 0; i <= stepsPerCap; i++) {
    const theta = baseAngle - Math.PI / 2 + (Math.PI * i) / stepsPerCap;
    const lon = end[0] + (radiusDegLat * Math.cos(theta)) / cosLat;
    const lat = end[1] + radiusDegLat * Math.sin(theta);
    ring.push([lon, lat]);
  }

  // Semicircle cap around `start` from +90 deg to +270 deg
  for (let i = 0; i <= stepsPerCap; i++) {
    const theta = baseAngle + Math.PI / 2 + (Math.PI * i) / stepsPerCap;
    const lon = start[0] + (radiusDegLat * Math.cos(theta)) / cosLat;
    const lat = start[1] + radiusDegLat * Math.sin(theta);
    ring.push([lon, lat]);
  }

  ring.push(ring[0]);
  return [ring];
}

/** Carefully tuned pixel offsets so reach and checkpoint badges never collide */
const REACH_PILL_OFFSET: Record<string, [number, number]> = {
  R1: [24, 24],
  R2A: [10, -28],
  R2B3: [-8, 38],
  R4A: [42, -10],
};

const NODE_PILL_OFFSET: Record<string, [number, number]> = {
  MIL: [-24, -24],
  GRF: [0, 26],
  SJB: [16, -34],
  SDP: [-44, 10],
  SWA: [16, -24],
};

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
  selected,
  onSelectReach,
  onSelectNode,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<
    Array<{ id: string; selectId: string; el: HTMLButtonElement; marker: maplibregl.Marker }>
  >([]);
  const reachCb = useRef(onSelectReach);
  const nodeCb = useRef(onSelectNode);
  const didFitBounds = useRef(false);
  reachCb.current = onSelectReach;
  nodeCb.current = onSelectNode;

  // Create map once
  useEffect(() => {
    if (!ref.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: ref.current,
      style: {
        version: 8,
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
      center: [-120.28, 36.93],
      zoom: 8.3,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;

    const interactiveLayers = () =>
      ["reaches-hit", "reaches-line", "leak-zone-fill", "farm-zone-fill"].filter((l) =>
        map.getLayer(l)
      );

    const pickTargetAt = (point: maplibregl.Point): { kind: "reach" | "node"; id: string } | null => {
      const reachLayers = ["reaches-hit", "reaches-line"].filter((l) => map.getLayer(l));
      if (reachLayers.length) {
        const bbox: [maplibregl.PointLike, maplibregl.PointLike] = [
          [point.x - 14, point.y - 14],
          [point.x + 14, point.y + 14],
        ];
        const feats = map.queryRenderedFeatures(bbox, { layers: reachLayers });
        const id = feats?.[0]?.properties?.id;
        if (id) return { kind: "reach", id: String(id) };
      }

      const zoneLayers = ["leak-zone-fill", "farm-zone-fill"].filter((l) => map.getLayer(l));
      if (zoneLayers.length) {
        const zoneFeats = map.queryRenderedFeatures(point, { layers: zoneLayers });
        const targetId = zoneFeats?.[0]?.properties?.targetId;
        const targetKind = zoneFeats?.[0]?.properties?.targetKind;
        if (targetId) {
          return {
            kind: targetKind === "node" ? "node" : "reach",
            id: String(targetId),
          };
        }
      }
      return null;
    };

    map.on("click", (e) => {
      const hit = pickTargetAt(e.point);
      if (!hit) return;
      if (hit.kind === "node") {
        nodeCb.current(hit.id);
      } else {
        reachCb.current(hit.id);
      }
    });

    map.on("mousemove", (e) => {
      if (!interactiveLayers().length) return;
      map.getCanvas().style.cursor = pickTargetAt(e.point) ? "pointer" : "";
    });

    return () => {
      markersRef.current.forEach((m) => m.marker.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update impact zones + canal reach lines + plain-English badges when bundle changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      const colorById = Object.fromEntries(
        bundle.reach_colors.map((r) => [
          r.id,
          reachColor(r.id, r.excess_loss_cfs, r.status),
        ])
      );
      const excessById = Object.fromEntries(
        bundle.reach_colors.map((r) => [r.id, r.excess_loss_cfs])
      );

      // 1. GeoJSON Impact Zones:
      //    - Red Major Leak Zone around Gravelly Ford -> Chowchilla (R2A)
      //    - Orange Downstream Affected Farm Zone around Chowchilla (SJB) & Dos Palos (SDP)
      const impactZonesGeoJSON = {
        type: "FeatureCollection" as const,
        features: [
          {
            type: "Feature" as const,
            properties: {
              id: "zone-major-leak",
              zoneType: "leak",
              targetKind: "reach",
              targetId: "R2A",
              title: "Major Leak Zone (Gravelly Ford → Chowchilla)",
            },
            geometry: {
              type: "Polygon" as const,
              coordinates: buildCorridorZonePolygon(
                [-120.162, 36.785],
                [-120.505, 36.978],
                0.052
              ),
            },
          },
          {
            type: "Feature" as const,
            properties: {
              id: "zone-affected-farms",
              zoneType: "farm",
              targetKind: "node",
              targetId: "SJB",
              title: "Downstream Affected Farm Area (Chowchilla & Dos Palos)",
            },
            geometry: {
              type: "Polygon" as const,
              coordinates: buildCorridorZonePolygon(
                [-120.505, 36.978],
                [-120.65, 36.983],
                0.058
              ),
            },
          },
        ],
      };

      const existingZones = map.getSource("impact-zones") as maplibregl.GeoJSONSource | undefined;
      if (existingZones) {
        existingZones.setData(impactZonesGeoJSON);
      } else {
        map.addSource("impact-zones", { type: "geojson", data: impactZonesGeoJSON });

        // Translucent orange fill for Downstream Affected Farm Area
        map.addLayer({
          id: "farm-zone-fill",
          type: "fill",
          source: "impact-zones",
          filter: ["==", ["get", "zoneType"], "farm"],
          paint: {
            "fill-color": "#f97316",
            "fill-opacity": 0.15,
          },
        });

        // Dashed orange outline for Downstream Affected Farm Area
        map.addLayer({
          id: "farm-zone-outline",
          type: "line",
          source: "impact-zones",
          filter: ["==", ["get", "zoneType"], "farm"],
          paint: {
            "line-color": "#f97316",
            "line-width": 2.5,
            "line-dasharray": [3, 3],
            "line-opacity": 0.85,
          },
        });

        // Translucent red fill for Major Leak Area (Gravelly Ford -> Chowchilla)
        map.addLayer({
          id: "leak-zone-fill",
          type: "fill",
          source: "impact-zones",
          filter: ["==", ["get", "zoneType"], "leak"],
          paint: {
            "fill-color": "#ef4444",
            "fill-opacity": 0.18,
          },
        });

        // Dashed red outline for Major Leak Area
        map.addLayer({
          id: "leak-zone-outline",
          type: "line",
          source: "impact-zones",
          filter: ["==", ["get", "zoneType"], "leak"],
          paint: {
            "line-color": "#ef4444",
            "line-width": 2.5,
            "line-dasharray": [4, 3],
            "line-opacity": 0.9,
          },
        });
      }

      // 2. Super bold, color-coded canal route lines
      const reachFeatures = bundle.geometry.reaches
        .filter((r) => Array.isArray(r.coordinates) && r.coordinates.length >= 2)
        .map((r) => ({
          type: "Feature" as const,
          properties: {
            id: r.id,
            name: r.name,
            color: colorById[r.id] ?? REACH_TRAFFIC_COLOR[r.id] ?? "#64748b",
            label: r.label,
          },
          geometry: {
            type: "LineString" as const,
            coordinates: r.coordinates,
          },
        }));

      const fc = { type: "FeatureCollection" as const, features: reachFeatures };
      const existingReaches = map.getSource("reaches") as maplibregl.GeoJSONSource | undefined;
      if (existingReaches) {
        existingReaches.setData(fc);
      } else {
        map.addSource("reaches", { type: "geojson", data: fc });

        // Bright red glow/halo layer behind the leaking canal section (R2A)
        map.addLayer({
          id: "reaches-leak-glow",
          type: "line",
          source: "reaches",
          filter: ["==", ["get", "id"], "R2A"],
          layout: {
            "line-cap": "round",
            "line-join": "round",
          },
          paint: {
            "line-color": "#ef4444",
            "line-width": 26,
            "line-opacity": 0.38,
            "line-blur": 6,
          },
        });

        // Selection highlight outer ring
        map.addLayer({
          id: "reaches-selected",
          type: "line",
          source: "reaches",
          filter: ["==", ["get", "id"], selected ?? ""],
          layout: {
            "line-cap": "round",
            "line-join": "round",
          },
          paint: {
            "line-color": "#ffffff",
            "line-width": 20,
            "line-opacity": 0.95,
          },
        });

        // Thick dark outer casing layer (line-width: 14, #0f172a, opacity 0.85)
        map.addLayer({
          id: "reaches-casing",
          type: "line",
          source: "reaches",
          layout: {
            "line-cap": "round",
            "line-join": "round",
          },
          paint: {
            "line-color": "#0f172a",
            "line-width": 14,
            "line-opacity": 0.85,
          },
        });

        // Bold main traffic-light canal line (line-width: 9)
        map.addLayer({
          id: "reaches-line",
          type: "line",
          source: "reaches",
          layout: {
            "line-cap": "round",
            "line-join": "round",
          },
          paint: {
            "line-color": ["get", "color"],
            "line-width": 9,
            "line-opacity": 1,
          },
        });

        // Wide transparent hit area for effortless clicking
        map.addLayer({
          id: "reaches-hit",
          type: "line",
          source: "reaches",
          layout: {
            "line-cap": "round",
            "line-join": "round",
          },
          paint: {
            "line-color": "#ffffff",
            "line-width": 32,
            "line-opacity": 0.001,
          },
        });
      }

      if (!didFitBounds.current) {
        const bounds = new maplibregl.LngLatBounds();
        for (const r of bundle.geometry.reaches) {
          for (const c of r.coordinates) {
            bounds.extend(c as [number, number]);
          }
        }
        for (const n of bundle.geometry.nodes) {
          bounds.extend([n.lon, n.lat]);
        }
        bounds.extend([-119.705, 37.001]); // Ensure Friant Dam source is in bounds
        if (!bounds.isEmpty()) {
          map.fitBounds(bounds, {
            padding: { top: 82, bottom: 135, left: 115, right: 105 },
            maxZoom: 9.2,
            duration: 0,
          });
          didFitBounds.current = true;
        }
      }

      markersRef.current.forEach((m) => m.marker.remove());
      markersRef.current = [];

      // 3. Plain-English Canal Reach Badges at midpoints
      for (const r of bundle.geometry.reaches) {
        if (!r.coordinates || r.coordinates.length < 2) continue;
        const [lon, lat] = midpoint(r.coordinates);
        const badge = reachPlainBadge(r.id, excessById[r.id]);
        const el = document.createElement("button");
        el.type = "button";
        el.className = `map-reach-pill ${badge.isMajorLeak ? "map-reach-pill-leak" : ""}`;
        el.dataset.reachId = r.id;
        el.textContent = badge.text;
        el.title = badge.title;
        el.setAttribute("aria-label", `${badge.text}. Click for leak analysis.`);
        el.style.cssText = [
          `background:${badge.bgColor}`,
          `color:${badge.textColor}`,
          `border:${badge.isMajorLeak ? "2.5px" : "2px"} solid ${badge.borderColor}`,
          "border-radius:999px",
          badge.isMajorLeak ? "padding:6px 12px" : "padding:5px 10px",
          badge.isMajorLeak
            ? "font:800 11.5px/1.25 Manrope,system-ui,sans-serif"
            : "font:700 10.5px/1.25 Manrope,system-ui,sans-serif",
          "cursor:pointer",
          badge.isMajorLeak
            ? "box-shadow:0 4px 16px rgba(239,68,68,0.42), 0 0 0 3px rgba(239,68,68,0.18)"
            : "box-shadow:0 3px 10px rgba(15,23,42,0.22)",
          `z-index:${badge.isMajorLeak ? "6" : "4"}`,
          "white-space:nowrap",
        ].join(";");
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          reachCb.current(r.id);
        });
        const pillOffset = REACH_PILL_OFFSET[r.id] ?? [0, -16];
        const marker = new maplibregl.Marker({ element: el, offset: pillOffset })
          .setLngLat([lon, lat])
          .addTo(map);
        markersRef.current.push({ id: r.id, selectId: r.id, el, marker });
      }

      // 4. Plain-English Checkpoint & Farm Impact Markers (including Friant Dam water source)
      const hasMilNode = bundle.geometry.nodes.some((n) => n.id === "MIL");
      const r1Coords = bundle.geometry.reaches.find((r) => r.id === "R1")?.coordinates;
      const friantLon = r1Coords?.[0]?.[0] ?? -119.705;
      const friantLat = r1Coords?.[0]?.[1] ?? 37.001;

      const allNodes: Array<{
        id: string;
        selectId: string;
        selectKind: "node" | "reach";
        name: string;
        lon: number;
        lat: number;
      }> = [
        ...(hasMilNode
          ? []
          : [
              {
                id: "MIL",
                selectId: "R1",
                selectKind: "reach" as const,
                name: "Friant Dam",
                lon: friantLon,
                lat: friantLat,
              },
            ]),
        ...bundle.geometry.nodes.map((n) => ({
          id: n.id,
          selectId: n.id,
          selectKind: "node" as const,
          name: n.name,
          lon: n.lon,
          lat: n.lat,
        })),
      ];

      for (const n of allNodes) {
        const s = shortfallByNode.get(n.id);
        const badge = nodePlainBadge(n.id, n.name, s?.shortfall_p50);
        const el = document.createElement("button");
        el.type = "button";
        el.className = `map-node ${badge.isAlert ? "map-node-alert" : ""}`;
        el.dataset.nodeId = n.id;
        el.textContent = badge.text;
        el.title = badge.title;
        el.setAttribute("aria-label", `${badge.text}. Click for farm delivery analysis.`);
        el.style.cssText = [
          `background:${badge.bgColor}`,
          `color:${badge.textColor}`,
          `border:${badge.isAlert ? "2.5px" : "2px"} solid ${badge.borderColor}`,
          "border-radius:8px",
          badge.isAlert ? "padding:5px 11px" : "padding:4px 9px",
          badge.isAlert
            ? "font:800 11px/1.25 Manrope,system-ui,sans-serif"
            : "font:700 10px/1.25 Manrope,system-ui,sans-serif",
          "cursor:pointer",
          badge.isAlert
            ? "box-shadow:0 4px 14px rgba(234,88,12,0.35), 0 0 0 3px rgba(249,115,22,0.16)"
            : "box-shadow:0 2px 8px rgba(15,23,42,0.2)",
          `z-index:${badge.isAlert ? "5" : "3"}`,
          "white-space:nowrap",
        ].join(";");
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          if (n.selectKind === "node") {
            nodeCb.current(n.selectId);
          } else {
            reachCb.current(n.selectId);
          }
        });
        const nodeOffset = NODE_PILL_OFFSET[n.id] ?? [0, 20];
        const marker = new maplibregl.Marker({ element: el, offset: nodeOffset })
          .setLngLat([n.lon, n.lat])
          .addTo(map);
        markersRef.current.push({ id: n.id, selectId: n.selectId, el, marker });
      }
    };

    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [bundle, shortfallByNode]);

  // Update selection highlight on map when `selected` changes
  useEffect(() => {
    const map = mapRef.current;
    if (map && map.getLayer("reaches-selected")) {
      map.setFilter("reaches-selected", ["==", ["get", "id"], selected ?? ""]);
    }
    for (const item of markersRef.current) {
      const isSel = item.id === selected || item.selectId === selected;
      item.el.style.outline = isSel ? "3px solid #0f172a" : "none";
      item.el.style.outlineOffset = isSel ? "2px" : "0px";
    }
  }, [selected]);

  const r2aExcessCfs =
    bundle.reach_colors.find((r) => r.id === "R2A")?.excess_loss_cfs ??
    bundle.headline.excess_loss_7d_cfs;
  const leakGallonsM = cfsToMillionsGallons(r2aExcessCfs, 48);
  const sjbShortfallCfs =
    shortfallByNode.get("SJB")?.shortfall_p50 ?? bundle.headline.worst_node_shortfall.p50;
  const sjbShortfallM = cfsToMillionsGallons(sjbShortfallCfs, 31);

  return (
    <div className="seepwatch-map-stage" style={{ position: "absolute", inset: 0 }}>
      <style>{`
        /* Keep WebGL canal traffic-light colors vivid and full-saturation */
        #map .maplibregl-canvas {
          filter: saturate(1.05) contrast(1.02) !important;
        }
        /* Hide any legacy duplicate legend/hint rendered outside MapView */
        .map-wrap > .map-legend:not(.map-legend-v2),
        .map-wrap > .map-hint:not(.map-hint-v2) {
          display: none !important;
        }
        .map-reach-pill,
        .map-node {
          min-height: 32px !important;
          min-width: auto !important;
          transition: transform 0.14s ease, box-shadow 0.14s ease;
        }
        .map-reach-pill:hover,
        .map-node:hover {
          transform: scale(1.04);
          z-index: 10 !important;
        }
        @keyframes leakPulseRing {
          0%, 100% {
            box-shadow: 0 4px 16px rgba(239, 68, 68, 0.45), 0 0 0 3px rgba(239, 68, 68, 0.22);
          }
          50% {
            box-shadow: 0 4px 20px rgba(239, 68, 68, 0.65), 0 0 0 6px rgba(239, 68, 68, 0.32);
          }
        }
        .map-reach-pill-leak {
          animation: leakPulseRing 2.2s infinite ease-in-out;
        }
      `}</style>

      {/* Main MapLibre Canvas Container */}
      <div id="map" ref={ref} style={{ position: "absolute", inset: 0 }} />

      {/* Top Quick-Select Bar Overlay */}
      <div
        className="map-hint map-hint-v2"
        role="toolbar"
        aria-label="Quick-select canal sections and farm checkpoints"
        style={{
          position: "absolute",
          top: 10,
          left: 10,
          right: 54,
          zIndex: 5,
          display: "flex",
          alignItems: "center",
          gap: 6,
          flexWrap: "wrap",
          padding: "7px 10px",
          background: "rgba(15, 23, 42, 0.9)",
          backdropFilter: "blur(8px)",
          borderRadius: 10,
          border: "1px solid rgba(255, 255, 255, 0.15)",
          boxShadow: "0 6px 20px rgba(15, 23, 42, 0.28)",
          color: "#f8fafc",
          fontSize: 11,
        }}
      >
        <span
          style={{
            fontWeight: 800,
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "#cbd5e1",
            marginRight: 4,
          }}
        >
          Jump to:
        </span>
        <button
          type="button"
          onClick={() => onSelectReach("R2A")}
          style={{
            padding: "4px 9px",
            borderRadius: 999,
            border: selected === "R2A" ? "2px solid #ffffff" : "1.5px solid #ef4444",
            background: selected === "R2A" ? "#ef4444" : "rgba(239, 68, 68, 0.22)",
            color: "#ffffff",
            fontWeight: 700,
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          🚨 Major Leak: Madera → Chowchilla ({leakGallonsM}M gal/day)
        </button>
        <button
          type="button"
          onClick={() => onSelectNode("SJB")}
          style={{
            padding: "4px 9px",
            borderRadius: 999,
            border: selected === "SJB" ? "2px solid #ffffff" : "1.5px solid #f97316",
            background: selected === "SJB" ? "#ea580c" : "rgba(249, 115, 22, 0.22)",
            color: "#ffffff",
            fontWeight: 700,
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          ⚠️ Chowchilla Farms (-{sjbShortfallM}M gal/day)
        </button>
        <button
          type="button"
          onClick={() => onSelectReach("R1")}
          style={{
            padding: "4px 9px",
            borderRadius: 999,
            border: selected === "R1" ? "2px solid #ffffff" : "1px solid rgba(249, 115, 22, 0.7)",
            background: selected === "R1" ? "#f97316" : "rgba(255, 255, 255, 0.1)",
            color: "#f8fafc",
            fontWeight: 600,
            fontSize: 10.5,
            cursor: "pointer",
          }}
        >
          🟠 Friant Dam → Madera
        </button>
        <button
          type="button"
          onClick={() => onSelectReach("R2B3")}
          style={{
            padding: "4px 9px",
            borderRadius: 999,
            border: selected === "R2B3" ? "2px solid #ffffff" : "1px solid rgba(34, 197, 94, 0.7)",
            background: selected === "R2B3" ? "#16a34a" : "rgba(255, 255, 255, 0.1)",
            color: "#f8fafc",
            fontWeight: 600,
            fontSize: 10.5,
            cursor: "pointer",
          }}
        >
          🟢 Chowchilla → Dos Palos
        </button>
        <button
          type="button"
          onClick={() => onSelectReach("R4A")}
          style={{
            padding: "4px 9px",
            borderRadius: 999,
            border: selected === "R4A" ? "2px solid #ffffff" : "1px solid rgba(234, 179, 8, 0.7)",
            background: selected === "R4A" ? "#ca8a04" : "rgba(255, 255, 255, 0.1)",
            color: "#f8fafc",
            fontWeight: 600,
            fontSize: 10.5,
            cursor: "pointer",
          }}
        >
          🟡 Dos Palos → Merced
        </button>
      </div>

      {/* Bottom-Left Ultra-Clear Visual Map Legend */}
      <div
        className="map-legend map-legend-v2"
        aria-label="Canal Leak and Farm Impact Map Key"
        style={{
          position: "absolute",
          left: 12,
          bottom: 12,
          zIndex: 5,
          maxWidth: 345,
          padding: "11px 13px",
          background: "rgba(255, 254, 249, 0.96)",
          backdropFilter: "blur(8px)",
          border: "1.5px solid rgba(15, 23, 42, 0.18)",
          borderRadius: 10,
          boxShadow: "0 6px 22px rgba(15, 23, 42, 0.18)",
          color: "#0f172a",
          fontSize: 11,
          lineHeight: 1.35,
        }}
      >
        <div
          style={{
            fontWeight: 800,
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.07em",
            color: "#334155",
            marginBottom: 7,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span>Map Guide · Canal Status &amp; Leak Zones</span>
        </div>

        <div style={{ display: "grid", gap: 5 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 24,
                height: 8,
                borderRadius: 999,
                background: "#ef4444",
                border: "1.5px solid #0f172a",
                boxShadow: "0 0 0 3px rgba(239, 68, 68, 0.25)",
                flexShrink: 0,
              }}
            />
            <span>
              🔴 <strong>Red Canal + Red Zone</strong> = Major Leak ({leakGallonsM}M gal/day wasted)
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 24,
                height: 8,
                borderRadius: 999,
                background: "#f97316",
                border: "1.5px solid #0f172a",
                flexShrink: 0,
              }}
            />
            <span>
              🟠 <strong>Orange Canal + Zone</strong> = Moderate Seepage / Farm Impact
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 24,
                height: 8,
                borderRadius: 999,
                background: "#eab308",
                border: "1.5px solid #0f172a",
                flexShrink: 0,
              }}
            />
            <span>
              🟡 <strong>Yellow Canal</strong> = Minor Watch Area
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 24,
                height: 8,
                borderRadius: 999,
                background: "#22c55e",
                border: "1.5px solid #0f172a",
                flexShrink: 0,
              }}
            />
            <span>
              🟢 <strong>Green Canal</strong> = Healthy Flow (No Leak)
            </span>
          </div>

          <div
            style={{
              height: 1,
              background: "rgba(15, 23, 42, 0.12)",
              margin: "3px 0",
            }}
          />

          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#334155" }}>
            <span style={{ fontSize: 12, flexShrink: 0 }}>⚠️</span>
            <span>
              <strong>Location Badges</strong> = Click any canal or town to see leak analysis
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
