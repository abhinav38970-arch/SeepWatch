import { useCallback, useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import type { Bundle } from "./types";
import "./map.css";

const GALLONS_PER_CFS_DAY = 646_317;
const SECONDARY_MIN_ZOOM = 8.4;

const RED = "#ff453a";
const ORANGE = "#ff9f0a";
const YELLOW = "#ffd60a";
const GREEN = "#30d158";

const REACH_TRAFFIC_COLOR: Record<string, string> = {
  R2A: RED,
  R1: ORANGE,
  R4A: YELLOW,
  R2B3: GREEN,
};

const REACH_FRIENDLY_NAME: Record<string, string> = {
  R1: "Friant Dam → Madera",
  R2A: "Madera → Chowchilla",
  R2B3: "Chowchilla → Dos Palos",
  R4A: "Dos Palos → Merced",
};

type TownSpec = {
  name: string;
  anchor: "left" | "right" | "top" | "bottom";
  offset: [number, number];
  secondary: boolean;
  arrivalReach?: string;
  color?: string;
};

/** Town labels sit beside the canal path, never on it. */
const TOWNS: Record<string, TownSpec> = {
  MIL: { name: "Friant Dam", anchor: "bottom", offset: [0, 0], secondary: false, color: "#64d2ff" },
  GRF: { name: "Madera", anchor: "top", offset: [0, 0], secondary: true, arrivalReach: "R1" },
  SJB: { name: "Chowchilla", anchor: "bottom", offset: [0, 0], secondary: false, color: ORANGE },
  SDP: { name: "Dos Palos", anchor: "top", offset: [0, 0], secondary: true, arrivalReach: "R2B3" },
  SWA: { name: "Merced", anchor: "right", offset: [0, 0], secondary: true, arrivalReach: "R4A" },
};

const TOWN_TITLES: Record<string, string> = {
  MIL: "Friant Dam (Millerton Lake), upstream water source",
  GRF: "Madera (Gravelly Ford checkpoint)",
  SJB: "Chowchilla (Bifurcation checkpoint)",
  SDP: "Dos Palos (Sack Dam checkpoint)",
  SWA: "Merced (Washington Rd checkpoint)",
};

function reachColor(
  id: string,
  excess: number | null | undefined,
  status: string
): string {
  if (REACH_TRAFFIC_COLOR[id]) return REACH_TRAFFIC_COLOR[id];
  if (status === "flagged") return RED;
  if (status === "no_forecast" || status === "flood_no_forecast") return YELLOW;
  const ex = excess ?? 0;
  if (ex > 25) return RED;
  if (ex > 0) return ORANGE;
  return GREEN;
}

function cfsToMillionsGallons(cfs: number | null | undefined, fallbackM: number): number {
  if (cfs == null || Number.isNaN(cfs)) return fallbackM;
  const m = Math.round((Math.abs(cfs) * GALLONS_PER_CFS_DAY) / 1_000_000);
  return m > 0 ? m : fallbackM;
}

function midSegment(coords: number[][]): { mid: [number, number]; a: number[]; b: number[] } {
  const n = coords.length;
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) {
    return {
      mid: [coords[mid][0], coords[mid][1]],
      a: coords[mid - 1],
      b: coords[mid + 1],
    };
  }
  return {
    mid: [(coords[mid - 1][0] + coords[mid][0]) / 2, (coords[mid - 1][1] + coords[mid][1]) / 2],
    a: coords[mid - 1],
    b: coords[mid],
  };
}

/**
 * Pixel offset that pushes a label of roughly (w x h) off the canal, perpendicular
 * to the on-screen tangent, preferring the side above the line.
 */
function offAxisOffset(
  map: maplibregl.Map,
  coords: number[][],
  w: number,
  h: number,
  gap = 8
): [number, number] {
  const { a, b } = midSegment(coords);
  const pa = map.project([a[0], a[1]]);
  const pb = map.project([b[0], b[1]]);
  const tx = pb.x - pa.x;
  const ty = pb.y - pa.y;
  const len = Math.hypot(tx, ty) || 1;
  let nx = -ty / len;
  let ny = tx / len;
  const narrow = map.getContainer().clientWidth < 600;
  if (narrow ? ny < 0 : ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  const dist = Math.abs(nx) * (w / 2) + Math.abs(ny) * (h / 2) + gap;
  return [Math.round(nx * dist), Math.round(ny * dist)];
}

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
  const baseAngle = Math.atan2(dy / len, dx / len);

  const ring: number[][] = [];

  for (let i = 0; i <= stepsPerCap; i++) {
    const theta = baseAngle - Math.PI / 2 + (Math.PI * i) / stepsPerCap;
    ring.push([
      end[0] + (radiusDegLat * Math.cos(theta)) / cosLat,
      end[1] + radiusDegLat * Math.sin(theta),
    ]);
  }

  for (let i = 0; i <= stepsPerCap; i++) {
    const theta = baseAngle + Math.PI / 2 + (Math.PI * i) / stepsPerCap;
    ring.push([
      start[0] + (radiusDegLat * Math.cos(theta)) / cosLat,
      start[1] + radiusDegLat * Math.sin(theta),
    ]);
  }

  ring.push(ring[0]);
  return [ring];
}

const FLOW_DASH_SEQUENCE: number[][] = [
  [0, 4, 3],
  [0.5, 4, 2.5],
  [1, 4, 2],
  [1.5, 4, 1.5],
  [2, 4, 1],
  [2.5, 4, 0.5],
  [3, 4, 0],
  [0, 0.5, 3, 3.5],
  [0, 1, 3, 3],
  [0, 1.5, 3, 2.5],
  [0, 2, 3, 2],
  [0, 2.5, 3, 1.5],
  [0, 3, 3, 1],
  [0, 3.5, 3, 0.5],
];

type MarkerItem = {
  id: string;
  selectId: string;
  el: HTMLButtonElement;
  marker: maplibregl.Marker;
};

type ReachInfo = { name: string; color: string; coords: number[][] };

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
  const tooltipRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<MarkerItem[]>([]);
  const selTagRef = useRef<maplibregl.Marker | null>(null);
  const reachInfoRef = useRef<Record<string, ReachInfo>>({});
  const selectedRef = useRef<string | null>(selected);
  const reachCb = useRef(onSelectReach);
  const nodeCb = useRef(onSelectNode);
  const didFitBounds = useRef(false);
  reachCb.current = onSelectReach;
  nodeCb.current = onSelectNode;
  selectedRef.current = selected;

  const syncSelection = useCallback(() => {
    const map = mapRef.current;
    const sel = selectedRef.current;
    if (map && map.getLayer("reaches-selected")) {
      map.setFilter("reaches-selected", ["==", ["get", "id"], sel ?? ""]);
    }
    for (const item of markersRef.current) {
      const isSel = !!sel && (item.id === sel || item.selectId === sel);
      item.el.classList.toggle("is-selected", isSel);
    }

    selTagRef.current?.remove();
    selTagRef.current = null;
    const info = sel ? reachInfoRef.current[sel] : undefined;
    if (map && sel && info && sel !== "R2A" && info.coords.length >= 2) {
      const el = document.createElement("div");
      el.className = "map-tag map-tag-static";
      el.style.setProperty("--c", info.color);
      el.setAttribute("aria-hidden", "true");
      el.textContent = info.name;
      const offset = offAxisOffset(map, info.coords, info.name.length * 6.2 + 16, 20, 10);
      selTagRef.current = new maplibregl.Marker({ element: el, offset })
        .setLngLat(midSegment(info.coords).mid)
        .addTo(map);
    }
  }, []);

  useEffect(() => {
    if (!ref.current || mapRef.current) return;

    const reduceMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const container = ref.current;
    const map = new maplibregl.Map({
      container,
      attributionControl: false,
      style: {
        version: 8,
        sources: {
          carto: {
            type: "raster",
            tiles: [
              "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
            ],
            maxzoom: 16,
            tileSize: 256,
            attribution: "© Esri © OpenStreetMap",
          },
        },
        layers: [
          { id: "bg", type: "background", paint: { "background-color": "#000000" } },
          { id: "carto", type: "raster", source: "carto", paint: { "raster-brightness-max": 0.55, "raster-saturation": -0.3 } },
        ],
      },
      center: [-120.28, 36.93],
      zoom: 8.3,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    mapRef.current = map;

    const updateZoomClass = () => {
      container.classList.toggle("map-zoom-low", map.getZoom() < SECONDARY_MIN_ZOOM);
    };
    map.on("zoom", updateZoomClass);
    map.on("load", updateZoomClass);

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
      const tip = tooltipRef.current;
      if (!interactiveLayers().length) return;
      const hit = pickTargetAt(e.point);
      map.getCanvas().style.cursor = hit ? "pointer" : "";
      if (!tip) return;
      const name = hit?.kind === "reach" ? reachInfoRef.current[hit.id]?.name : undefined;
      if (name) {
        tip.textContent = name;
        tip.style.left = `${e.point.x}px`;
        tip.style.top = `${e.point.y}px`;
        tip.style.display = "block";
      } else {
        tip.style.display = "none";
      }
    });

    map.on("mouseout", () => {
      if (tooltipRef.current) tooltipRef.current.style.display = "none";
    });

    let raf = 0;
    let lastStep = 0;
    let frame = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - lastStep < 110 || !map.getLayer("reaches-flow")) return;
      lastStep = t;
      frame = (frame + 1) % FLOW_DASH_SEQUENCE.length;
      map.setPaintProperty("reaches-flow", "line-dasharray", FLOW_DASH_SEQUENCE[frame]);
    };
    if (!reduceMotion) raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      markersRef.current.forEach((m) => m.marker.remove());
      markersRef.current = [];
      selTagRef.current?.remove();
      selTagRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const reduceMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const apply = () => {
      const colorById: Record<string, string> = Object.fromEntries(
        bundle.reach_colors.map((r) => [r.id, reachColor(r.id, r.excess_loss_cfs, r.status)])
      );
      const excessById = Object.fromEntries(
        bundle.reach_colors.map((r) => [r.id, r.excess_loss_cfs])
      );

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
              title: "Major Leak Zone (Madera → Chowchilla)",
            },
            geometry: {
              type: "Polygon" as const,
              coordinates: buildCorridorZonePolygon([-120.162, 36.785], [-120.505, 36.978], 0.052),
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
              coordinates: buildCorridorZonePolygon([-120.505, 36.978], [-120.65, 36.983], 0.058),
            },
          },
        ],
      };

      const existingZones = map.getSource("impact-zones") as maplibregl.GeoJSONSource | undefined;
      if (existingZones) {
        existingZones.setData(impactZonesGeoJSON);
      } else {
        map.addSource("impact-zones", { type: "geojson", data: impactZonesGeoJSON });

        map.addLayer({
          id: "farm-zone-fill",
          type: "fill",
          source: "impact-zones",
          filter: ["==", ["get", "zoneType"], "farm"],
          paint: { "fill-color": ORANGE, "fill-opacity": 0.07 },
        });
        map.addLayer({
          id: "farm-zone-outline",
          type: "line",
          source: "impact-zones",
          filter: ["==", ["get", "zoneType"], "farm"],
          paint: {
            "line-color": ORANGE,
            "line-width": 1,
            "line-dasharray": [3, 3],
            "line-opacity": 0.6,
          },
        });
        map.addLayer({
          id: "leak-zone-fill",
          type: "fill",
          source: "impact-zones",
          filter: ["==", ["get", "zoneType"], "leak"],
          paint: { "fill-color": RED, "fill-opacity": 0.09 },
        });
        map.addLayer({
          id: "leak-zone-outline",
          type: "line",
          source: "impact-zones",
          filter: ["==", ["get", "zoneType"], "leak"],
          paint: {
            "line-color": RED,
            "line-width": 1,
            "line-dasharray": [4, 3],
            "line-opacity": 0.65,
          },
        });
      }

      const reachInfo: Record<string, ReachInfo> = {};
      const reachFeatures = bundle.geometry.reaches
        .filter((r) => Array.isArray(r.coordinates) && r.coordinates.length >= 2)
        .map((r) => {
          const color = colorById[r.id] ?? REACH_TRAFFIC_COLOR[r.id] ?? "#8e8e93";
          reachInfo[r.id] = {
            name: REACH_FRIENDLY_NAME[r.id] ?? r.name,
            color,
            coords: r.coordinates,
          };
          return {
            type: "Feature" as const,
            properties: { id: r.id, name: r.name, color, label: r.label },
            geometry: { type: "LineString" as const, coordinates: r.coordinates },
          };
        });
      reachInfoRef.current = reachInfo;

      const fc = { type: "FeatureCollection" as const, features: reachFeatures };
      const existingReaches = map.getSource("reaches") as maplibregl.GeoJSONSource | undefined;
      if (existingReaches) {
        existingReaches.setData(fc);
      } else {
        map.addSource("reaches", { type: "geojson", data: fc });
        const round = { "line-cap": "round", "line-join": "round" } as const;

        map.addLayer({
          id: "reaches-glow",
          type: "line",
          source: "reaches",
          layout: round,
          paint: {
            "line-color": ["get", "color"],
            "line-width": ["interpolate", ["linear"], ["zoom"], 7, 15, 10, 32],
            "line-blur": ["interpolate", ["linear"], ["zoom"], 7, 6, 10, 12],
            "line-opacity": ["case", ["==", ["get", "id"], "R2A"], 0.5, 0.32],
          },
        });

        map.addLayer({
          id: "reaches-selected",
          type: "line",
          source: "reaches",
          filter: ["==", ["get", "id"], selectedRef.current ?? ""],
          layout: round,
          paint: {
            "line-color": "#ffffff",
            "line-width": ["interpolate", ["linear"], ["zoom"], 7, 12, 10, 19],
            "line-opacity": 0.95,
          },
        });

        map.addLayer({
          id: "reaches-casing",
          type: "line",
          source: "reaches",
          layout: round,
          paint: {
            "line-color": "#05070a",
            "line-width": ["interpolate", ["linear"], ["zoom"], 7, 9, 10, 15],
            "line-opacity": 0.9,
          },
        });

        map.addLayer({
          id: "reaches-line",
          type: "line",
          source: "reaches",
          layout: round,
          paint: {
            "line-color": ["get", "color"],
            "line-width": ["interpolate", ["linear"], ["zoom"], 7, 6, 10, 10],
            "line-opacity": 1,
          },
        });

        map.addLayer({
          id: "reaches-flow",
          type: "line",
          source: "reaches",
          layout: { "line-cap": "butt", "line-join": "round" },
          paint: {
            "line-color": "#ffffff",
            "line-width": 1.5,
            "line-opacity": reduceMotion ? 0 : 0.7,
            "line-dasharray": FLOW_DASH_SEQUENCE[0],
          },
        });

        map.addLayer({
          id: "reaches-hit",
          type: "line",
          source: "reaches",
          layout: round,
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
          for (const c of r.coordinates) bounds.extend(c as [number, number]);
        }
        for (const n of bundle.geometry.nodes) bounds.extend([n.lon, n.lat]);
        bounds.extend([-119.705, 37.001]);
        if (!bounds.isEmpty()) {
          const narrow = map.getContainer().clientWidth < 600;
          map.fitBounds(bounds, {
            padding: narrow
              ? { top: 40, bottom: 56, left: 28, right: 52 }
              : { top: 50, bottom: 60, left: 70, right: 60 },
            maxZoom: 10,
            duration: 0,
          });
          didFitBounds.current = true;
        }
      }
      map.getContainer().classList.toggle("map-zoom-low", map.getZoom() < SECONDARY_MIN_ZOOM);

      markersRef.current.forEach((m) => m.marker.remove());
      markersRef.current = [];

      const addMarker = (
        item: Omit<MarkerItem, "marker">,
        lngLat: [number, number],
        anchor: maplibregl.PositionAnchor,
        offset: [number, number]
      ) => {
        const marker = new maplibregl.Marker({ element: item.el, anchor, offset })
          .setLngLat(lngLat)
          .addTo(map);
        markersRef.current.push({ ...item, marker });
      };

      // Single leak label on the red canal, offset off the line.
      const r2a = bundle.geometry.reaches.find((r) => r.id === "R2A");
      if (r2a && r2a.coordinates.length >= 2) {
        const lostM = cfsToMillionsGallons(excessById["R2A"], 48);
        const text = `${lostM}M wasted`;
        const el = document.createElement("button");
        el.type = "button";
        el.className = "map-tag map-tag-leak";
        el.dataset.reachId = "R2A";
        el.textContent = text;
        el.title = `Madera → Chowchilla: about ${lostM}M gallons/day lost to leakage. Click for analysis.`;
        el.setAttribute(
          "aria-label",
          `Major leak between Madera and Chowchilla, ${lostM} million gallons per day wasted. Open leak analysis.`
        );
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          reachCb.current("R2A");
        });
        addMarker(
          { id: "R2A", selectId: "R2A", el },
          midSegment(r2a.coordinates).mid,
          "center",
          offAxisOffset(map, r2a.coordinates, text.length * 6.4 + 18, 22, 10)
        );
      }

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

      const selectNode = (n: (typeof allNodes)[number]) => {
        if (n.selectKind === "node") nodeCb.current(n.selectId);
        else reachCb.current(n.selectId);
      };

      for (const n of allNodes) {
        const spec: TownSpec = TOWNS[n.id] ?? {
          name: n.name,
          anchor: "top",
          offset: [0, 0],
          secondary: true,
        };
        const dotColor =
          spec.color ?? (spec.arrivalReach ? colorById[spec.arrivalReach] : undefined) ?? "#e5e7eb";
        const el = document.createElement("button");
        el.type = "button";
        const layout =
          spec.anchor === "top"
            ? "map-town-col"
            : spec.anchor === "bottom"
              ? "map-town-col-rev"
              : spec.anchor === "right"
                ? "map-town-row-rev"
                : "";
        el.className = `map-town ${layout} ${spec.secondary ? "map-secondary" : ""}`.trim();
        el.dataset.nodeId = n.id;
        el.style.setProperty("--c", dotColor);
        el.title = TOWN_TITLES[n.id] ?? `${spec.name} checkpoint`;
        el.setAttribute("aria-label", `${spec.name}. Open delivery details.`);
        const dot = document.createElement("span");
        dot.className = "map-town-dot";
        dot.setAttribute("aria-hidden", "true");
        const label = document.createElement("span");
        label.className = "map-town-name";
        label.textContent = spec.name;
        el.append(dot, label);
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          selectNode(n);
        });

        // Centre the dot (not the text box) on the node position.
        const dotShift: [number, number] =
          spec.anchor === "left"
            ? [-7, 0]
            : spec.anchor === "right"
              ? [7, 0]
              : spec.anchor === "top"
                ? [0, -6]
                : [0, 6];
        addMarker({ id: n.id, selectId: n.selectId, el }, [n.lon, n.lat], spec.anchor, [
          dotShift[0] + spec.offset[0],
          dotShift[1] + spec.offset[1],
        ]);

        if (n.id === "SJB") {
          const shortM = cfsToMillionsGallons(
            shortfallByNode.get(n.id)?.shortfall_p50,
            31
          );
          const tag = document.createElement("button");
          tag.type = "button";
          tag.className = "map-tag map-tag-farm map-farm-tag";
          tag.dataset.nodeId = "SJB-farms";
          tag.textContent = `${shortM}M short`;
          tag.title = `Chowchilla farms: about ${shortM}M gallons/day projected shortfall from the upstream leak.`;
          tag.setAttribute(
            "aria-label",
            `Chowchilla farms, ${shortM} million gallons per day short. Open delivery details.`
          );
          tag.addEventListener("click", (ev) => {
            ev.stopPropagation();
            selectNode(n);
          });
          addMarker({ id: n.id, selectId: n.selectId, el: tag }, [n.lon, n.lat], "top", [-26, 14]);
        }
      }

      syncSelection();
    };

    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [bundle, shortfallByNode, syncSelection]);

  useEffect(() => {
    syncSelection();
  }, [selected, syncSelection]);

  return (
    <div className="seepwatch-map-stage" style={{ position: "absolute", inset: 0 }}>
      <div id="map" ref={ref} style={{ position: "absolute", inset: 0 }} />
      <div ref={tooltipRef} className="map-tooltip" role="tooltip" style={{ display: "none" }} />

      <div className="map-legend map-legend-v2" role="group" aria-label="Canal status legend">
        <span className="map-legend-item" style={{ ["--c" as string]: RED }}>
          <i />
          Leak
        </span>
        <span className="map-legend-item" style={{ ["--c" as string]: ORANGE }}>
          <i />
          Watch
        </span>
        <span className="map-legend-item" style={{ ["--c" as string]: YELLOW }}>
          <i />
          Minor
        </span>
        <span className="map-legend-item" style={{ ["--c" as string]: GREEN }}>
          <i />
          Healthy
        </span>
      </div>
    </div>
  );
}
