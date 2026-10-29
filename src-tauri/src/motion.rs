//! Window motion for the pet: dragging, throwing (ballistic flight with wall /
//! floor collisions) and per-region click-through.
//!
//! Everything runs on one background thread that owns the window position, so
//! the movement stays smooth even when the webview is busy. Coordinates inside
//! the loop are physical pixels; the frontend talks in CSS (logical) pixels.
//!
//! Locking rule: never call a window API while holding the state mutex. Window
//! getters (cursor, position, monitors) round-trip through the main thread, and
//! the main thread may itself be waiting for the mutex → deadlock. So every tick
//! snapshots the state, does window work unlocked, and writes back only if no
//! command replaced the phase in the meantime (tracked by `epoch`).

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewWindow};

/// Rectangle in window-local logical pixels: [left, top, right, bottom].
pub type Rect = [f64; 4];

const GRAVITY: f64 = 2600.0; // logical px / s²
const THROW_SPEED: f64 = 700.0; // release speed that counts as a throw
const DRAG_THRESHOLD: f64 = 4.0; // logical px before a press becomes a drag
const WALL_BOUNCE: f64 = 0.55;
const FLOOR_BOUNCE: f64 = 0.32;
const MAX_FLIGHT: Duration = Duration::from_secs(8);

#[derive(Clone, Copy, Debug)]
struct Area {
    left: f64,
    top: f64,
    right: f64,
    bottom: f64,
}

#[derive(Clone, Copy, Debug)]
enum Phase {
    Idle,
    Pressed { grab: (f64, f64), start: (f64, f64) },
    Dragging { grab: (f64, f64) },
    /// `area` is the screen work area, looked up once when the flight starts.
    Flying { vx: f64, vy: f64, since: Instant, max_impact: f64, grounded: bool, area: Option<Area> },
    /// `linear`: constant speed (walking); otherwise smoothstep.
    Gliding { from: (f64, f64), to: (f64, f64), start: Instant, dur: f64, linear: bool },
}

struct State {
    phase: Phase,
    /// Bumped whenever a command replaces `phase`, so a tick computed from an
    /// older snapshot doesn't overwrite it.
    epoch: u64,
    samples: VecDeque<(Instant, f64, f64)>,
    /// Body used for collisions, window-local logical px.
    body: Rect,
    /// Regions that should receive the mouse; everything else clicks through.
    hit_rects: Vec<Rect>,
    ignoring: Option<bool>,
    last_cursor_emit: Instant,
    /// Where the speech bubble should point: [head x, head top, head half-width],
    /// window-local logical px. None while no bubble is showing.
    bubble_anchor: Option<[f64; 3]>,
}

impl State {
    fn set_phase(&mut self, phase: Phase) {
        self.phase = phase;
        self.epoch += 1;
    }
}

#[derive(Clone)]
pub struct Motion(Arc<Mutex<State>>);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MotionEvent {
    kind: &'static str,
    vx: f64,
    vy: f64,
    impact: f64,
    side: &'static str,
}

impl MotionEvent {
    fn new(kind: &'static str) -> Self {
        Self { kind, vx: 0.0, vy: 0.0, impact: 0.0, side: "" }
    }
}

impl Motion {
    pub fn new() -> Self {
        Motion(Arc::new(Mutex::new(State {
            phase: Phase::Idle,
            epoch: 0,
            samples: VecDeque::new(),
            body: [80.0, 160.0, 220.0, 392.0],
            hit_rects: Vec::new(),
            ignoring: None,
            last_cursor_emit: Instant::now(),
            bubble_anchor: None,
        })))
    }

    pub fn start(&self, window: WebviewWindow, bubble: Option<WebviewWindow>) {
        let state = self.0.clone();
        let mut bubble = bubble.map(|window| BubbleWindow { window, area: None, last: None });
        thread::spawn(move || {
            let mut last = Instant::now();
            loop {
                let busy = !matches!(state.lock().unwrap().phase, Phase::Idle);
                thread::sleep(Duration::from_millis(if busy { 8 } else { 33 }));
                let now = Instant::now();
                let dt = (now - last).as_secs_f64().min(0.05);
                last = now;
                if let Err(e) = tick(&state, &window, bubble.as_mut(), dt) {
                    log::debug!("motion tick: {e}");
                }
            }
        });
    }
}

fn scale(window: &WebviewWindow) -> f64 {
    window.scale_factor().unwrap_or(1.0)
}

/// Work area of the monitor containing `center`. Calls into the main thread:
/// never call this while holding the state lock.
fn work_area(window: &WebviewWindow, center: (f64, f64)) -> Option<Area> {
    let m = window
        .monitor_from_point(center.0, center.1)
        .ok()
        .flatten()
        .or_else(|| window.current_monitor().ok().flatten())?;
    let wa = m.work_area();
    Some(Area {
        left: wa.position.x as f64,
        top: wa.position.y as f64,
        right: wa.position.x as f64 + wa.size.width as f64,
        bottom: wa.position.y as f64 + wa.size.height as f64,
    })
}

fn body_center(body: &Rect, pos: (f64, f64), k: f64) -> (f64, f64) {
    (pos.0 + (body[0] + body[2]) / 2.0 * k, pos.1 + (body[1] + body[3]) / 2.0 * k)
}

fn emit(window: &WebviewWindow, ev: MotionEvent) {
    let _ = window.emit_to(window.label(), "pet-motion", ev);
}

fn set_pos(window: &WebviewWindow, x: f64, y: f64) {
    let _ = window.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32));
}

/// One step of ballistic flight. Pure: returns the new phase, the new window
/// position and the events to emit.
fn fly_step(
    phase: Phase,
    body: &Rect,
    (wx, wy): (f64, f64),
    k: f64,
    dt: f64,
    now: Instant,
    events: &mut Vec<MotionEvent>,
) -> (Phase, (f64, f64)) {
    let Phase::Flying { mut vx, mut vy, since, mut max_impact, mut grounded, area: Some(area) } = phase else {
        return (Phase::Idle, (wx, wy));
    };
    let body = body.map(|v| v * k);
    vy += GRAVITY * k * dt;
    let mut x = wx + vx * dt;
    let mut y = wy + vy * dt;

    let mut bump = |side: &'static str, speed: f64, max_impact: &mut f64| {
        let speed = speed.abs() / k;
        *max_impact = max_impact.max(speed);
        if speed > 250.0 {
            events.push(MotionEvent { impact: speed, side, ..MotionEvent::new("bump") });
        }
    };

    if x + body[0] < area.left {
        x = area.left - body[0];
        bump("left", vx, &mut max_impact);
        vx = -vx * WALL_BOUNCE;
    } else if x + body[2] > area.right {
        x = area.right - body[2];
        bump("right", vx, &mut max_impact);
        vx = -vx * WALL_BOUNCE;
    }
    if y + body[1] < area.top {
        y = area.top - body[1];
        bump("top", vy, &mut max_impact);
        vy = -vy * WALL_BOUNCE;
    }
    if y + body[3] >= area.bottom {
        y = area.bottom - body[3];
        if vy > 0.0 {
            if !grounded {
                bump("bottom", vy, &mut max_impact);
            }
            vy = if vy < 260.0 * k { 0.0 } else { -vy * FLOOR_BOUNCE };
            vx *= 0.82;
        }
        if vy == 0.0 {
            grounded = true;
            vx *= (-7.0 * dt).exp();
        }
    }

    if (grounded && vx.abs() < 25.0 * k) || now - since > MAX_FLIGHT {
        events.push(MotionEvent { impact: max_impact, ..MotionEvent::new("landed") });
        (Phase::Idle, (x, y))
    } else {
        events.push(MotionEvent { vx: vx / k, vy: vy / k, ..MotionEvent::new("flying") });
        (Phase::Flying { vx, vy, since, max_impact, grounded, area: Some(area) }, (x, y))
    }
}

fn tick(state: &Arc<Mutex<State>>, window: &WebviewWindow, bubble: Option<&mut BubbleWindow>, dt: f64) -> tauri::Result<()> {
    // 1. Window queries, unlocked.
    let cursor = window.cursor_position()?;
    let pos = window.outer_position()?;
    let k = scale(window);
    let (cx, cy) = (cursor.x, cursor.y);
    let (wx, wy) = (pos.x as f64, pos.y as f64);
    let lx = (cx - wx) / k;
    let ly = (cy - wy) / k;
    let now = Instant::now();

    // 2. Snapshot (and drag samples) under a short lock.
    let (mut phase, epoch, body, drag_velocity, over, bubble_anchor) = {
        let mut s = state.lock().unwrap();
        let mut v = (0.0, 0.0);
        if let Phase::Dragging { .. } = s.phase {
            s.samples.push_back((now, cx, cy));
            while s.samples.len() > 2 && now - s.samples[0].0 > Duration::from_millis(90) {
                s.samples.pop_front();
            }
            v = velocity(&s.samples);
        }
        let over = s.hit_rects.iter().any(|r| lx >= r[0] && lx <= r[2] && ly >= r[1] && ly <= r[3]);
        (s.phase, s.epoch, s.body, v, over, s.bubble_anchor)
    };

    // A new flight needs to know which screen it's on; look it up once, unlocked.
    if let Phase::Flying { area: ref mut a @ None, .. } = phase {
        *a = work_area(window, body_center(&body, (wx, wy), k));
        if a.is_none() {
            phase = Phase::Idle;
        }
    }

    // 3. Advance, without the lock.
    let mut events = Vec::new();
    let mut new_pos = None;
    let mut new_phase = phase;
    let mut reset_samples = false;
    match phase {
        Phase::Idle => {}
        Phase::Pressed { grab, start } => {
            if ((cx - start.0).powi(2) + (cy - start.1).powi(2)).sqrt() > DRAG_THRESHOLD * k {
                new_phase = Phase::Dragging { grab };
                reset_samples = true;
                events.push(MotionEvent::new("drag-start"));
            }
        }
        Phase::Dragging { grab } => {
            new_pos = Some((cx - grab.0, cy - grab.1));
            let (vx, vy) = drag_velocity;
            events.push(MotionEvent { vx: vx / k, vy: vy / k, ..MotionEvent::new("dragging") });
        }
        Phase::Flying { .. } => {
            let (p, xy) = fly_step(phase, &body, (wx, wy), k, dt, now, &mut events);
            new_phase = p;
            new_pos = Some(xy);
        }
        Phase::Gliding { from, to, start, dur, linear } => {
            let t = ((now - start).as_secs_f64() / dur).min(1.0);
            let e = if linear { t } else { t * t * (3.0 - 2.0 * t) };
            new_pos = Some((from.0 + (to.0 - from.0) * e, from.1 + (to.1 - from.1) * e));
            if t >= 1.0 {
                new_phase = Phase::Idle;
                events.push(MotionEvent::new("glide-end"));
            }
        }
    }

    // 4. Write back, unless a command replaced the phase meanwhile.
    let (apply, ignore_change, emit_cursor) = {
        let mut s = state.lock().unwrap();
        let apply = s.epoch == epoch;
        if apply {
            s.phase = new_phase;
            if reset_samples {
                s.samples.clear();
            }
        }
        let held = matches!(s.phase, Phase::Pressed { .. } | Phase::Dragging { .. });
        let ignore = !(held || over);
        let ignore_change = (s.ignoring != Some(ignore)).then(|| {
            s.ignoring = Some(ignore);
            ignore
        });
        let emit_cursor = now - s.last_cursor_emit > Duration::from_millis(100);
        if emit_cursor {
            s.last_cursor_emit = now;
        }
        (apply, ignore_change, emit_cursor)
    };

    // 5. Side effects, unlocked.
    if apply {
        if let Some((x, y)) = new_pos {
            set_pos(window, x, y);
        }
        for ev in events {
            emit(window, ev);
        }
    }
    if let Some(ignore) = ignore_change {
        window.set_ignore_cursor_events(ignore)?;
    }
    if emit_cursor {
        let _ = window.emit_to(window.label(), "pet-cursor", (lx, ly));
    }

    // 6. The speech bubble window follows the pet.
    if let Some(b) = bubble {
        let pet = if apply { new_pos.unwrap_or((wx, wy)) } else { (wx, wy) };
        follow_bubble(window, b, bubble_anchor, &body, pet, k, now);
    }
    Ok(())
}

/// Logical size of the bubble window (matches tauri.conf.json).
const BUBBLE_SIZE: (f64, f64) = (240.0, 150.0);

/// The speech bubble lives in its own small, click-through window so the pet
/// window can stay tight around her. Owned by the motion thread (not shared).
struct BubbleWindow {
    window: WebviewWindow,
    /// Cached work area, refreshed every half second (monitor queries are main-thread round trips).
    area: Option<(Instant, Area)>,
    /// Last physical position, side and tail offset sent, to skip redundant updates.
    last: Option<((i32, i32), &'static str, i32)>,
}

#[derive(Serialize, Clone)]
struct BubblePlace {
    side: &'static str,
    /// Tail position along the bubble's edge, logical px from its left (above) or top (sides).
    tail: f64,
}

/// Put the bubble above her head, or beside it when there's no room above.
/// Never called with the state lock held.
fn follow_bubble(pet_window: &WebviewWindow, b: &mut BubbleWindow, anchor: Option<[f64; 3]>, body: &Rect, pet: (f64, f64), k: f64, now: Instant) {
    let Some([hx, htop, half]) = anchor else {
        b.last = None;
        return;
    };
    if b.area.is_none_or(|(t, _)| now - t > Duration::from_millis(500))
        && let Some(a) = work_area(pet_window, body_center(body, pet, k))
    {
        b.area = Some((now, a));
    }
    let Some((_, area)) = b.area else { return };
    let (bw, bh) = (BUBBLE_SIZE.0 * k, BUBBLE_SIZE.1 * k);
    let head_x = pet.0 + hx * k;
    let head_top = pet.1 + htop * k;

    let (side, mut x, y) = if head_top - bh >= area.top {
        ("above", head_x - bw / 2.0, head_top - bh + 4.0 * k)
    } else {
        let y = (head_top + 6.0 * k).max(area.top);
        let right = pet.0 + (hx + half) * k;
        if right + bw <= area.right { ("right", right, y) } else { ("left", pet.0 + (hx - half) * k - bw, y) }
    };
    x = x.clamp(area.left, (area.right - bw).max(area.left));
    let tail = if side == "above" { (head_x - x) / k } else { (head_top + 30.0 * k - y) / k };
    let pos = (x.round() as i32, y.round() as i32);
    let tail_i = tail.round() as i32;

    if b.last.map(|l| l.0) != Some(pos) {
        let _ = b.window.set_position(PhysicalPosition::new(pos.0, pos.1));
    }
    if b.last.map(|l| (l.1, l.2)) != Some((side, tail_i)) {
        let _ = b.window.emit_to(b.window.label(), "bubble-place", BubblePlace { side, tail });
    }
    b.last = Some((pos, side, tail_i));
}

fn velocity(samples: &VecDeque<(Instant, f64, f64)>) -> (f64, f64) {
    let (Some(a), Some(b)) = (samples.front(), samples.back()) else {
        return (0.0, 0.0);
    };
    let dt = (b.0 - a.0).as_secs_f64();
    if dt < 0.008 {
        return (0.0, 0.0);
    }
    ((b.1 - a.1) / dt, (b.2 - a.2) / dt)
}

/// If the body is (partly) off-screen, the window position that brings it back.
/// Calls into the main thread: never call this while holding the state lock.
fn clamp_into_screen(window: &WebviewWindow, body: &Rect, pos: (f64, f64), k: f64) -> Option<(f64, f64)> {
    let a = work_area(window, body_center(body, pos, k))?;
    let b = body.map(|v| v * k);
    let x = pos.0.clamp(a.left - b[0], (a.right - b[2]).max(a.left - b[0]));
    let y = pos.1.clamp(a.top - b[1], (a.bottom - b[3]).max(a.top - b[1]));
    ((x - pos.0).abs() > 0.5 || (y - pos.1).abs() > 0.5).then_some((x, y))
}

// Commands are async so they run off the main thread; they still must not hold
// the lock across window calls.

/// Mouse went down on the pet.
#[tauri::command]
pub async fn drag_begin(window: WebviewWindow, motion: tauri::State<'_, Motion>) -> tauri::Result<()> {
    let cursor = window.cursor_position()?;
    let pos = window.outer_position()?;
    motion.0.lock().unwrap().set_phase(Phase::Pressed {
        grab: (cursor.x - pos.x as f64, cursor.y - pos.y as f64),
        start: (cursor.x, cursor.y),
    });
    Ok(())
}

/// Mouse released. Returns "click", "drop", "throw", or "edge-left" / "edge-right"
/// when she was dropped pushed against a screen side (the frontend then docks her there).
#[tauri::command]
pub async fn drag_end(window: WebviewWindow, motion: tauri::State<'_, Motion>) -> tauri::Result<&'static str> {
    let k = scale(&window);
    let p = window.outer_position()?;
    let pos = (p.x as f64, p.y as f64);

    let (result, body) = {
        let mut s = motion.0.lock().unwrap();
        match s.phase {
            Phase::Pressed { .. } => {
                s.set_phase(Phase::Idle);
                ("click", s.body)
            }
            Phase::Dragging { .. } => {
                let (vx, vy) = velocity(&s.samples);
                if (vx * vx + vy * vy).sqrt() / k > THROW_SPEED {
                    // Cap so a frantic flick doesn't tunnel across the screen in one frame.
                    let cap = 6000.0 * k;
                    s.set_phase(Phase::Flying {
                        vx: vx.clamp(-cap, cap),
                        vy: vy.clamp(-cap, cap),
                        since: Instant::now(),
                        max_impact: 0.0,
                        grounded: false,
                        area: None,
                    });
                    ("throw", s.body)
                } else {
                    s.set_phase(Phase::Idle);
                    ("drop", s.body)
                }
            }
            _ => ("none", s.body),
        }
    };

    if result == "drop" {
        // Pushed against a screen side: let the frontend dock her there (peeking).
        if let Some(a) = work_area(&window, body_center(&body, pos, k)) {
            if pos.0 + body[0] * k <= a.left + 2.0 * k {
                return Ok("edge-left");
            }
            if pos.0 + body[2] * k >= a.right - 2.0 * k {
                return Ok("edge-right");
            }
        }
        // Dropped partly off-screen: glide back in.
        if let Some(to) = clamp_into_screen(&window, &body, pos, k) {
            let mut s = motion.0.lock().unwrap();
            if matches!(s.phase, Phase::Idle) {
                s.set_phase(Phase::Gliding { from: pos, to, start: Instant::now(), dur: 0.25, linear: false });
            }
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn set_body(motion: tauri::State<'_, Motion>, body: Rect) -> Result<(), ()> {
    motion.0.lock().unwrap().body = body;
    Ok(())
}

/// Where the speech bubble should point (or None when it's hidden).
#[tauri::command]
pub async fn set_bubble(motion: tauri::State<'_, Motion>, anchor: Option<[f64; 3]>) -> Result<(), ()> {
    motion.0.lock().unwrap().bubble_anchor = anchor;
    Ok(())
}

#[tauri::command]
pub async fn set_hit_rects(motion: tauri::State<'_, Motion>, rects: Vec<Rect>) -> Result<(), ()> {
    motion.0.lock().unwrap().hit_rects = rects;
    Ok(())
}

/// Let the pet fall to the floor of the current screen (e.g. after waking up).
#[tauri::command]
pub async fn fall(motion: tauri::State<'_, Motion>) -> Result<(), ()> {
    let mut s = motion.0.lock().unwrap();
    if matches!(s.phase, Phase::Idle) {
        s.set_phase(Phase::Flying { vx: 0.0, vy: 0.0, since: Instant::now(), max_impact: 0.0, grounded: false, area: None });
    }
    Ok(())
}

/// Move horizontally by `dx` logical px at `speed` px/s, staying on screen.
/// `linear` keeps the speed constant (walking). `span` is the window-local
/// [left, right] (logical px) of what is drawn while moving — walk frames are
/// wider than the body rect — and is kept on screen too. Returns the actual dx;
/// 0 when the only way to stay on screen is backwards.
#[tauri::command]
pub async fn glide_by(
    window: WebviewWindow,
    motion: tauri::State<'_, Motion>,
    dx: f64,
    speed: f64,
    linear: bool,
    span: Option<[f64; 2]>,
) -> tauri::Result<f64> {
    let k = scale(&window);
    let p = window.outer_position()?;
    let from = (p.x as f64, p.y as f64);
    let (idle, body) = {
        let s = motion.0.lock().unwrap();
        (matches!(s.phase, Phase::Idle), s.body)
    };
    if !idle {
        return Ok(0.0);
    }
    let target = (from.0 + dx * k, from.1);
    let mut to = clamp_into_screen(&window, &body, target, k).unwrap_or(target);
    if let Some([l, r]) = span
        && let Some(a) = work_area(&window, body_center(&body, from, k))
    {
        to.0 = to.0.min(a.right - r * k).max(a.left - l * k);
    }
    if dx != 0.0 && (to.0 - from.0) * dx < 0.0 {
        to.0 = from.0; // already at the edge: don't moonwalk away from it
    }
    let mut s = motion.0.lock().unwrap();
    if !matches!(s.phase, Phase::Idle) {
        return Ok(0.0);
    }
    let moved = (to.0 - from.0) / k;
    let dur = (moved.abs() / speed.max(1.0)).max(0.1);
    s.set_phase(Phase::Gliding { from, to, start: Instant::now(), dur, linear });
    Ok(moved)
}

/// Place the pet at the bottom-right corner of the primary work area.
pub fn place_initially(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else { return };
    let Some(m) = window.primary_monitor().ok().flatten() else { return };
    let wa = m.work_area();
    let Ok(size) = window.outer_size() else { return };
    let margin = 40.0 * m.scale_factor();
    let x = wa.position.x as f64 + wa.size.width as f64 - size.width as f64 - margin;
    let y = wa.position.y as f64 + wa.size.height as f64 - size.height as f64 + 8.0 * m.scale_factor();
    set_pos(&window, x, y);
}

/// Dev builds only: launch the pet as if thrown with velocity (logical px/s).
#[tauri::command]
pub async fn debug_throw(window: WebviewWindow, motion: tauri::State<'_, Motion>, vx: f64, vy: f64) -> Result<(), ()> {
    if cfg!(debug_assertions) {
        let k = scale(&window);
        let since = Instant::now();
        motion.0.lock().unwrap().set_phase(Phase::Flying { vx: vx * k, vy: vy * k, since, max_impact: 0.0, grounded: false, area: None });
    }
    Ok(())
}

/// Hide at a screen side: slide the window so window-local x `edge_x` (logical)
/// lands exactly on the left / right screen edge, keeping the window-local
/// vertical span `top..bottom` (the visible part) on screen.
#[tauri::command]
pub async fn dock(window: WebviewWindow, motion: tauri::State<'_, Motion>, side: String, edge_x: f64, top: f64, bottom: f64) -> tauri::Result<()> {
    let k = scale(&window);
    let p = window.outer_position()?;
    let from = (p.x as f64, p.y as f64);
    // Find the screen from the part of her that's visible (just inside the edge):
    // once docked, her body center is off-screen and may lie on a neighbouring monitor.
    let inside = if side == "left" { 12.0 } else { -12.0 };
    let probe = (from.0 + (edge_x + inside) * k, from.1 + (top + bottom) / 2.0 * k);
    let Some(a) = work_area(&window, probe) else { return Ok(()) };
    let x = if side == "left" { a.left } else { a.right } - edge_x * k;
    let y = from.1.clamp(a.top - top * k, (a.bottom - bottom * k).max(a.top - top * k));
    motion.0.lock().unwrap().set_phase(Phase::Gliding { from, to: (x, y), start: Instant::now(), dur: 0.22, linear: false });
    Ok(())
}

/// Resize the pet window to `factor` × the base size, keeping the feet (bottom
/// center) where they are. Base size matches tauri.conf.json.
#[tauri::command]
pub async fn set_pet_scale(window: WebviewWindow, factor: f64) -> tauri::Result<()> {
    const BASE: (f64, f64) = (332.0, 290.0);
    let k = scale(&window);
    let pos = window.outer_position()?;
    let size = window.outer_size()?;
    let (w, h) = ((BASE.0 * factor * k).round(), (BASE.1 * factor * k).round());
    if (w - size.width as f64).abs() < 1.0 && (h - size.height as f64).abs() < 1.0 {
        return Ok(());
    }
    let x = pos.x as f64 + (size.width as f64 - w) / 2.0;
    let y = pos.y as f64 + size.height as f64 - h;
    window.set_size(tauri::PhysicalSize::new(w as u32, h as u32))?;
    set_pos(&window, x, y);
    Ok(())
}

/// Dev builds only: try to place the window `above` px over the work-area top and
/// report where it actually ended up (macOS may clamp windows below the menu bar).
#[tauri::command]
pub async fn debug_probe_top(window: WebviewWindow, above: f64) -> tauri::Result<String> {
    if !cfg!(debug_assertions) {
        return Ok(String::new());
    }
    let k = scale(&window);
    let pos = window.outer_position()?;
    let Some(area) = work_area(&window, (pos.x as f64, pos.y as f64)) else { return Ok("no monitor".into()) };
    let want = area.top - above * k;
    set_pos(&window, pos.x as f64, want);
    std::thread::sleep(Duration::from_millis(200));
    let got = window.outer_position()?;
    set_pos(&window, pos.x as f64, pos.y as f64);
    Ok(format!("work-area top {} wanted y {} got y {} (scale {k})", area.top, want, got.y))
}

/// Dev builds only: optionally move the pet window to `to` (logical px from the
/// work area's top-left), then report where the pet and bubble windows are.
#[tauri::command]
pub async fn debug_windows(app: AppHandle, to: Option<(f64, f64)>) -> tauri::Result<String> {
    if !cfg!(debug_assertions) {
        return Ok(String::new());
    }
    let (Some(main), Some(bubble)) = (app.get_webview_window("main"), app.get_webview_window("bubble")) else {
        return Ok("missing window".into());
    };
    let k = scale(&main);
    let p = main.outer_position()?;
    let Some(area) = work_area(&main, (p.x as f64, p.y as f64)) else { return Ok("no monitor".into()) };
    if let Some((x, y)) = to {
        set_pos(&main, area.left + x * k, area.top + y * k);
        std::thread::sleep(Duration::from_millis(600));
    }
    let (mp, ms, bp) = (main.outer_position()?, main.outer_size()?, bubble.outer_position()?);
    Ok(format!(
        "scale {k} area left {} top {} right {} pet ({}, {}) {}x{} bubble ({}, {})",
        area.left, area.top, area.right, mp.x, mp.y, ms.width, ms.height, bp.x, bp.y
    ))
}
