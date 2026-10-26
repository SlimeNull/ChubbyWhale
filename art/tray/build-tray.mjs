// Render the tray icons from art/tray/whale.svg.
// Usage (from repo root): node art/tray/build-tray.mjs
//
// - tray-template.png: black on transparent; macOS tints it like a system icon.
// - tray-color.png:    blue whale with a white fill, readable on dark and light taskbars (Windows).
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";

const src = readFileSync(new URL("./whale.svg", import.meta.url), "utf8");
const out = new URL("../../src-tauri/icons/tray/", import.meta.url);
mkdirSync(out, { recursive: true });

function render(svg, size, file) {
  const png = new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
  writeFileSync(new URL(file, out), png);
  console.log(`${file} ${size}px`);
}

// macOS menu bar: 22pt tall → 44px at @2x.
render(src.replaceAll("currentColor", "#000000"), 44, "tray-template.png");

// Windows: fill the body so it reads as a solid shape on any taskbar color.
const color = src
  .replaceAll("currentColor", "#2f5bea")
  .replace('fill="none"', 'fill="#ffffff"')
  .replace(/<path stroke-width="3" d="M11 40[^>]*\/>/, (m) => m.replace("<path", '<path fill="none"'))
  .replace(/<path stroke-width="3.5" d="M25 16[^>]*\/>/, (m) => m.replace("<path", '<path fill="none"'));
render(color, 64, "tray-color.png");
