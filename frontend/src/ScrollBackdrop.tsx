import { useEffect, useRef, useState } from "react";
import "./backdrop.css";

export type Scene = { src: string; pos?: string };

export const SCENES: Scene[] = [
  { src: "/bg/scene1.webp", pos: "50% 55%" },
  { src: "/bg/scene2.webp", pos: "50% 50%" },
  { src: "/bg/scene4.webp", pos: "50% 50%" },
  { src: "/bg/scene5.webp", pos: "50% 60%" },
];

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (t: number) => t * t * (3 - 2 * t);

function preload(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = src;
  });
}

export default function ScrollBackdrop() {
  const [ready, setReady] = useState<Scene[]>([]);
  const layers = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    let dead = false;
    const ok = new Set<string>();
    const publish = () => {
      if (!dead) setReady(SCENES.filter((s) => ok.has(s.src)));
    };
    const [first, ...rest] = SCENES;
    const idle: (cb: () => void) => void =
      "requestIdleCallback" in window
        ? (cb) => (window as unknown as { requestIdleCallback: (f: () => void) => void }).requestIdleCallback(cb)
        : (cb) => window.setTimeout(cb, 400);

    preload(first.src).then((good) => {
      if (good) ok.add(first.src);
      publish();
      idle(() => {
        rest.forEach((s) =>
          preload(s.src).then((g) => {
            if (g) ok.add(s.src);
            publish();
          }),
        );
      });
    });
    return () => {
      dead = true;
    };
  }, []);

  useEffect(() => {
    const n = ready.length;
    if (!n) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const small = window.matchMedia("(max-width: 600px)").matches;
    const amp = small ? 0.5 : 1;
    let raf = 0;

    const apply = () => {
      raf = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const p = max > 0 ? clamp(window.scrollY / max) : 0;
      layers.current.forEach((el, i) => {
        if (!el) return;
        if (reduce) {
          el.style.opacity = i === 0 ? "1" : "0";
          return;
        }
        const pos = n > 1 ? p * (n - 1) : 0;
        const op = n > 1 ? smooth(clamp(1 - Math.abs(pos - i))) : 1;
        const u = clamp((pos - i + 1) / 2);
        const scale = 1.04 + 0.05 * amp * u;
        const ty = (1.5 - 3 * u) * amp;
        el.style.opacity = op.toFixed(3);
        el.style.transform = `translate3d(0,${ty.toFixed(2)}%,0) scale(${scale.toFixed(4)})`;
      });
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };

    apply();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    ro?.observe(document.body);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      ro?.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ready]);

  return (
    <div className="bd" aria-hidden="true">
      <div className="bd-glow" />
      {ready.map((s, i) => (
        <div
          key={s.src}
          className="bd-layer"
          ref={(el) => {
            layers.current[i] = el;
          }}
          style={{ backgroundImage: `url(${s.src})`, backgroundPosition: s.pos ?? "50% 50%", opacity: i === 0 ? 1 : 0 }}
        />
      ))}
      <div className="bd-tint" />
      <div className="bd-shade" />
      <div className="bd-vignette" />
    </div>
  );
}
