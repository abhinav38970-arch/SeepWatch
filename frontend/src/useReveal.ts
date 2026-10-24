import { createElement, useEffect, useRef, useState } from "react";
import type { CSSProperties, ElementType, ReactNode } from "react";

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Returns a ref and a boolean that flips to true (once) when the element
 * scrolls into view. With reduced motion, or no IntersectionObserver, it is
 * true immediately.
 */
export function useReveal<T extends HTMLElement = HTMLElement>(
  options: { threshold?: number; rootMargin?: string } = {}
) {
  const { threshold = 0.18, rootMargin = "0px 0px -8% 0px" } = options;
  const ref = useRef<T | null>(null);
  const [shown, setShown] = useState(() => prefersReducedMotion() || typeof IntersectionObserver === "undefined");

  useEffect(() => {
    if (shown) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold, rootMargin }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown, threshold, rootMargin]);

  return { ref, shown };
}

type RevealProps = {
  children?: ReactNode;
  /** Delay in seconds before the fade-in starts. */
  delay?: number;
  className?: string;
  as?: ElementType;
  style?: CSSProperties;
};

/** Fades and slides its children up when scrolled into view (once). */
export function Reveal({ children, delay = 0, className = "", as = "div", style }: RevealProps) {
  const { ref, shown } = useReveal<HTMLElement>();
  const cls = ["lp-reveal", shown ? "is-in" : "", className].filter(Boolean).join(" ");
  return createElement(
    as,
    {
      ref,
      className: cls,
      style: { ...style, ["--lp-delay" as string]: `${delay}s` } as CSSProperties,
    },
    children
  );
}

type CountUpProps = {
  to: number;
  suffix?: string;
  prefix?: string;
  /** Duration in ms. */
  duration?: number;
  /** Delay in ms before counting starts once visible. */
  delay?: number;
  decimals?: number;
  className?: string;
};

/** Counts from 0 to `to` the first time it is visible. */
export function CountUp({
  to,
  suffix = "",
  prefix = "",
  duration = 1600,
  delay = 0,
  decimals = 0,
  className,
}: CountUpProps) {
  const { ref, shown } = useReveal<HTMLSpanElement>({ threshold: 0.4, rootMargin: "0px" });
  const reduced = prefersReducedMotion();
  const [value, setValue] = useState(reduced ? to : 0);

  useEffect(() => {
    if (!shown) return;
    if (reduced) {
      setValue(to);
      return;
    }
    let raf = 0;
    let start = 0;
    const tick = (t: number) => {
      if (!start) start = t;
      const p = Math.min(1, Math.max(0, (t - start - delay) / duration));
      setValue(to * (1 - Math.pow(1 - p, 4)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [shown, reduced, to, duration, delay]);

  const text = decimals > 0 ? value.toFixed(decimals) : String(Math.round(value));

  return createElement(
    "span",
    { ref, className, "aria-label": `${prefix}${to}${suffix}` },
    prefix,
    text,
    suffix ? createElement("span", { className: "lp-m", "aria-hidden": true }, suffix) : null
  );
}
