// Speech bubble above the pet's head, typed out character by character.

export class Bubble {
  private el: HTMLDivElement;
  private textEl: HTMLSpanElement;
  private typing = 0;
  private hideTimer = 0;
  /** True while characters are still appearing (drives the mouth). */
  talking = false;
  visible = false;
  onChange: () => void = () => {};

  constructor(host: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "bubble";
    this.textEl = document.createElement("span");
    this.el.appendChild(this.textEl);
    host.appendChild(this.el);
    this.el.addEventListener("click", () => this.hide());
  }

  /** Place the bubble so its tail points at (x, y). */
  anchor(x: number, y: number) {
    const w = this.el.offsetWidth;
    const left = Math.max(6, Math.min(window.innerWidth - w - 6, x - w / 2));
    this.el.style.left = `${left}px`;
    this.el.style.top = `${Math.max(4, y - this.el.offsetHeight - 10)}px`;
    this.el.style.setProperty("--tail-x", `${Math.max(16, Math.min(w - 16, x - left))}px`);
  }

  show(text: string, ms?: number) {
    clearInterval(this.typing);
    clearTimeout(this.hideTimer);
    const chars = [...text];
    let i = 0;
    this.textEl.textContent = "";
    this.el.classList.add("show");
    this.visible = true;
    this.talking = true;
    this.onChange();
    this.typing = window.setInterval(() => {
      this.textEl.textContent = chars.slice(0, ++i).join("");
      this.onChange();
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
    this.visible = false;
    this.el.classList.remove("show");
    this.onChange();
  }

  rect(): [number, number, number, number] | null {
    if (!this.visible) return null;
    const r = this.el.getBoundingClientRect();
    return [r.left, r.top, r.right, r.bottom];
  }
}
