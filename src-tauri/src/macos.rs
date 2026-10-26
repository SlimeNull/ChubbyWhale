//! macOS: let the pet's windows go above the menu bar.
//!
//! AppKit keeps windows below the menu bar by routing every move through
//! `-[NSWindow constrainFrameRect:toScreen:]`. The pet window has transparent
//! headroom for effects above her head, so the clamp stopped her well short of
//! the top of the screen. We give tao's window class an override that returns
//! the frame unchanged (the same trick Electron uses for `enableLargerThanScreen`).

use std::ffi::{CStr, c_void};

use objc2::ffi::class_addMethod;
use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
use objc2::sel;

/// Same layout and ABI as `CGRect` / `NSRect` on 64-bit macOS.
#[repr(C)]
#[derive(Clone, Copy)]
struct Rect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

unsafe extern "C-unwind" fn constrain_frame_rect(_this: *mut AnyObject, _cmd: Sel, frame: Rect, _screen: *mut AnyObject) -> Rect {
    frame
}

/// Install the override on the class of `ns_window` (once per class; later calls are no-ops).
pub fn allow_above_menu_bar(ns_window: *mut c_void) {
    if ns_window.is_null() {
        return;
    }
    const TYPES: &CStr = c"{CGRect={CGPoint=dd}{CGSize=dd}}@:{CGRect={CGPoint=dd}{CGSize=dd}}@";
    unsafe {
        let cls: &AnyClass = (*(ns_window as *const AnyObject)).class();
        let f: unsafe extern "C-unwind" fn(*mut AnyObject, Sel, Rect, *mut AnyObject) -> Rect = constrain_frame_rect;
        let imp: Imp = std::mem::transmute(f);
        class_addMethod(cls as *const AnyClass as *mut AnyClass, sel!(constrainFrameRect:toScreen:), imp, TYPES.as_ptr());
    }
}
