// Speech bubble text and timing. The bubble is drawn in its own click-through
// window (bubble.html), which the Rust motion thread keeps next to her head;
// this side types the text out and reports where her head is.
import { emitTo } from "@tauri-apps/api/event";
import { ipc } from "../ipc";

export class Bubble {
  private typing = 0;
  private hideTimer = 0;
  private anchorKey = "";
  /** True while characters are still appearing (drives the mouth). */
  talking = false;
  visible = false;
  /** Called when the bubble appears, so the owner can report the head position right away. */
  onChange: () => void = () => {};

  private send(text: string, show: boolean) {
    emitTo("bubble", "bubble-text", { text, show }).catch(() => {});
  }

  /** Point the bubble at her head: x, head top, head half-width (window-local CSS px). */
  anchor(x: number, top: number, half: number) {
    if (!this.visible) return;
    const key = [x, top, half].map(Math.round).join(",");
    if (key === this.anchorKey) return;
    this.anchorKey = key;
    ipc.setBubble([x, top, half]);
  }

  show(text: string, ms?: number) {
    clearInterval(this.typing);
    clearTimeout(this.hideTimer);
    const chars = [...text];
    let i = 0;
    this.visible = true;
    this.talking = true;
    this.onChange();
    this.typing = window.setInterval(() => {
      this.send(chars.slice(0, ++i).join(""), true);
      if (i >= chars.length) {
        clearInterval(this.typing);
        this.talking = false;
      }
    }, 55);
    const stay = ms ?? Math.min(9000, 2600 + chars.length * 160);
    this.hideTimer = window.setTimeout(() => this.hide(), stay + chars.length * 55);
  }

  hide() {
    clearInterval(this.typing);
    clearTimeout(this.hideTimer);
    this.talking = false;
    if (!this.visible) return;
    this.visible = false;
    this.anchorKey = "";
    this.send("", false);
    ipc.setBubble(null);
  }
}
