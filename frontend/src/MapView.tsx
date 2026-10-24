import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import type { Bundle } from "./types";

function reachColor(
  excess: number | null | undefined,
  status: string
): string {
  if (status === "no_forecast" || status === "flood_no_forecast") return "#475569";
  if (status === "flagged") return "#f07178";
  const ex = excess ?? 0;
  if (ex > 25) return "#f07178";
  if (ex > 8) return "#f0b429";
  return "#3dd6c6";
}

function shortfallColor(p50: number): string {
  if (p50 > 20) return "#f07178";
  if (p50 > 5) return "#c084fc";
  if (p50 < -5) return "#6bcb8b";
  return "#94a3b8";
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

/** Pixel offsets so reach pills don't sit under node markers at endpoints. */
const REACH_PILL_OFFSET: Record<string, [number, number]> = {
  R1: [16, -20],
  R2A: [0, -14],
  R2B3: [0, 14],
  R4A: [-18, -18],
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
  const markersRef = useRef<Array<{ id: string; el: HTMLButtonElement; marker: maplibregl.Marker }>>([]);
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

    const reachLayers = () =>
      ["reaches-hit", "reaches-line"].filter((l) => map.getLayer(l));

    const pickReachAt = (point: maplibregl.Point) => {
      const layers = reachLayers();
      if (!layers.length) return null;
      const bbox: [maplibregl.PointLike, maplibregl.PointLike] = [
        [point.x - 14, point.y - 14],
        [point.x + 14, point.y + 14],
      ];
      const feats = map.queryRenderedFeatures(bbox, { layers });
      const id = feats?.[0]?.properties?.id;
      return id ? String(id) : null;
    };

    const onReachLayerClick = (e: maplibregl.MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.id;
      if (id) {
        e.originalEvent.preventDefault();
        reachCb.current(String(id));
      }
    };

    map.on("click", (e) => {
      const id = pickReachAt(e.point);
      if (id) reachCb.current(id);
    });

    map.on("mousemove", (e) => {
      map.getCanvas().style.cursor = pickReachAt(e.point) ? "pointer" : "";
    });

    map.on("click", "reaches-hit", onReachLayerClick);
    map.on("click", "reaches-line", onReachLayerClick);

    return () => {
      markersRef.current.forEach((m) => m.marker.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update reach lines + node/reach markers when bundle changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      const colorById = Object.fromEntries(
        bundle.reach_colors.map((r) => [
          r.id,
          reachColor(r.excess_loss_cfs, r.status),
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
        // Selection highlight casing layer
        map.addLayer({
          id: "reaches-selected",
          type: "line",
          source: "reaches",
          filter: ["==", ["get", "id"], selected ?? ""],
          paint: {
            "line-color": "#fffef9",
            "line-width": 11,
            "line-opacity": 0.9,
          },
        });
        // Visible reach line
        map.addLayer({
          id: "reaches-line",
          type: "line",
          source: "reaches",
          paint: {
            "line-color": ["get", "color"],
            "line-width": 6,
            "line-opacity": 0.95,
          },
        });
        // Wide transparent hit area for reliable clicking
        map.addLayer({
          id: "reaches-hit",
          type: "line",
          source: "reaches",
          paint: {
            "line-color": "#ffffff",
            "line-width": 28,
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
        if (!bounds.isEmpty()) {
          map.fitBounds(bounds, { padding: 72, maxZoom: 9.4, duration: 0 });
          didFitBounds.current = true;
        }
      }

      markersRef.current.forEach((m) => m.marker.remove());
      markersRef.current = [];

      // Clickable reach label pills at reach midpoints
      for (const r of bundle.geometry.reaches) {
        if (!r.coordinates || r.coordinates.length < 2) continue;
        const [lon, lat] = midpoint(r.coordinates);
        const c = colorById[r.id] ?? "#64748b";
        const el = document.createElement("button");
        el.type = "button";
        el.className = "map-reach-pill";
        el.dataset.reachId = r.id;
        el.textContent = r.id;
        el.title = `${r.name} (click for details)`;
        el.style.cssText = [
          "background:rgba(255,254,249,0.96)",
          "color:#10231f",
          `border:2px solid ${c}`,
          "border-radius:3px",
          "padding:4px 7px",
          "font:700 10px/1.2 Manrope,system-ui,sans-serif",
          "cursor:pointer",
          "box-shadow:0 2px 8px rgba(16,35,31,0.24)",
          "z-index:2",
          "position:relative",
        ].join(";");
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          reachCb.current(r.id);
        });
        const pillOffset = REACH_PILL_OFFSET[r.id] ?? [0, -12];
        const marker = new maplibregl.Marker({ element: el, offset: pillOffset })
          .setLngLat([lon, lat])
          .addTo(map);
        markersRef.current.push({ id: r.id, el, marker });
      }

      // Clickable node markers
      for (const n of bundle.geometry.nodes) {
        const s = shortfallByNode.get(n.id);
        const color = s ? shortfallColor(s.shortfall_p50) : "#94a3b8";
        const el = document.createElement("button");
        el.type = "button";
        el.className = "map-node";
        el.dataset.nodeId = n.id;
        el.textContent = n.name;
        el.title = `${n.name}: click for modeled downstream effect`;
        el.style.cssText = [
          "background:rgba(255,254,249,0.96)",
          "color:#10231f",
          `border:2px solid ${color}`,
          "border-radius:3px",
          "padding:4px 7px",
          "font:700 9px/1.2 Manrope,system-ui,sans-serif",
          "cursor:pointer",
          "box-shadow:0 2px 8px rgba(16,35,31,0.2)",
        ].join(";");
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          nodeCb.current(n.id);
        });
        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([n.lon, n.lat])
          .addTo(map);
        markersRef.current.push({ id: n.id, el, marker });
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
      const isSel = item.id === selected;
      item.el.style.outline = isSel ? "3px solid #f16d3a" : "none";
      item.el.style.outlineOffset = isSel ? "2px" : "0px";
    }
  }, [selected]);

  return <div id="map" ref={ref} />;
}
