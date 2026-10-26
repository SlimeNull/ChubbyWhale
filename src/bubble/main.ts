// The speech bubble window: a dumb renderer. The pet window sends the text,
// the Rust motion thread moves this window next to her head and says which
// side it ended up on and where the tail should point.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./bubble.css";

type Side = "above" | "right" | "left";

const el = document.getElementById("bubble")!;
const textEl = el.querySelector("span")!;
let side: Side = "above";
let tail = 120;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function layout() {
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  document.body.dataset.side = side;
  if (side === "above") {
    const left = clamp(tail - w / 2, 4, innerWidth - w - 4);
    el.style.left = `${left}px`;
    el.style.top = `${innerHeight - h - 12}px`;
    el.style.setProperty("--tail", `${clamp(tail - left, 16, w - 16)}px`);
  } else {
    const top = clamp(tail - 22, 4, innerHeight - h - 4);
    el.style.left = side === "right" ? "12px" : `${innerWidth - w - 12}px`;
    el.style.top = `${top}px`;
    el.style.setProperty("--tail", `${clamp(tail - top, 14, h - 14)}px`);
  }
  // Dev tests check placement from this log (no screenshots available).
  if (import.meta.env.DEV && el.classList.contains("show")) {
    const data = `bubble layout ${JSON.stringify({ side, tail, left: el.offsetLeft, top: el.offsetTop, w, h })}`;
    invoke("debug_dump", { name: "log.txt", data }).catch(() => {});
  }
}

listen<{ text: string; show: boolean }>("bubble-text", (e) => {
  textEl.textContent = e.payload.text;
  el.classList.toggle("show", e.payload.show && e.payload.text.length > 0);
  layout();
});

listen<{ side: Side; tail: number }>("bubble-place", (e) => {
  side = e.payload.side;
  tail = e.payload.tail;
  layout();
});
