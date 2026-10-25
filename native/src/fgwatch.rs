//! Which program owns the foreground window, for the HUD overlays (electron/foregroundWatch.cjs).
//!
//! Replaces the hidden PowerShell that compiled a C# helper on every start and then held ~74 MB for the
//! app's whole run (1.3.1, owner 2026-10-25: "add both to 1.3.1, use Rust"). Same output, one line per change:
//! the process name (no ".exe"), a tab, and the window's centre in screen pixels ("x,y", empty when it could
//! not be read). Polls every 400 ms; per-monitor DPI aware, so the centre is in real pixels on every monitor.
//!
//! Usage: edexo-fgwatch <parent pid>. Ends when that process is gone or nobody reads the output any more.
#![windows_subsystem = "windows"]

#[cfg(windows)]
mod win {
    use std::ffi::c_void;

    pub type Handle = *mut c_void;

    #[repr(C)]
    #[derive(Default, Clone, Copy)]
    pub struct Rect {
        pub left: i32,
        pub top: i32,
        pub right: i32,
        pub bottom: i32,
    }

    pub const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    pub const SYNCHRONIZE: u32 = 0x0010_0000;
    pub const WAIT_OBJECT_0: u32 = 0;
    /// DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2
    pub const PER_MONITOR_AWARE_V2: isize = -4;

    #[link(name = "user32")]
    extern "system" {
        pub fn GetForegroundWindow() -> Handle;
        pub fn GetWindowThreadProcessId(hwnd: Handle, pid: *mut u32) -> u32;
        pub fn GetWindowRect(hwnd: Handle, rect: *mut Rect) -> i32;
        pub fn SetProcessDpiAwarenessContext(value: isize) -> i32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        pub fn OpenProcess(access: u32, inherit: i32, pid: u32) -> Handle;
        pub fn QueryFullProcessImageNameW(process: Handle, flags: u32, name: *mut u16, size: *mut u32) -> i32;
        pub fn WaitForSingleObject(handle: Handle, ms: u32) -> u32;
        pub fn CloseHandle(handle: Handle) -> i32;
    }

    /// The program's file name without ".exe", as PowerShell's ProcessName gave it; "" when it cannot be read.
    pub fn process_name(pid: u32) -> String {
        if pid == 0 {
            return String::new();
        }
        unsafe {
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if h.is_null() {
                return String::new();
            }
            let mut buf = [0u16; 1024];
            let mut len = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(h, 0, buf.as_mut_ptr(), &mut len);
            CloseHandle(h);
            if ok == 0 {
                return String::new();
            }
            let path = String::from_utf16_lossy(&buf[..len as usize]);
            let file = path.rsplit(['\\', '/']).next().unwrap_or("");
            match file.len().checked_sub(4) {
                Some(n) if file[n..].eq_ignore_ascii_case(".exe") => file[..n].to_string(),
                _ => file.to_string(),
            }
        }
    }
}

#[cfg(windows)]
fn main() {
    use std::io::Write;
    use std::{thread, time::Duration};
    use win::*;

    let parent: u32 = std::env::args().nth(1).and_then(|a| a.parse().ok()).unwrap_or(0);
    unsafe {
        SetProcessDpiAwarenessContext(PER_MONITOR_AWARE_V2);
    }
    // The app that started this: when it is gone (crashed, ended in Task Manager), so is this.
    let parent_handle = if parent != 0 { unsafe { OpenProcess(SYNCHRONIZE, 0, parent) } } else { std::ptr::null_mut() };

    let mut out = std::io::stdout().lock();
    let mut last_pid: u32 = u32::MAX;
    let mut last_at = String::from("\u{0}");
    loop {
        if !parent_handle.is_null() && unsafe { WaitForSingleObject(parent_handle, 0) } == WAIT_OBJECT_0 {
            return;
        }
        let (pid, at) = unsafe {
            let h = GetForegroundWindow();
            let mut pid = 0u32;
            GetWindowThreadProcessId(h, &mut pid);
            let mut r = Rect::default();
            let at = if !h.is_null() && GetWindowRect(h, &mut r) != 0 {
                format!("{},{}", (r.left + r.right) / 2, (r.top + r.bottom) / 2)
            } else {
                String::new()
            };
            (pid, at)
        };
        if pid != last_pid || at != last_at {
            last_pid = pid;
            last_at.clone_from(&at);
            let line = format!("{}\t{}\n", process_name(pid), at);
            // Nobody reading any more (the app went): end.
            if out.write_all(line.as_bytes()).and_then(|_| out.flush()).is_err() {
                return;
            }
        }
        thread::sleep(Duration::from_millis(400));
    }
}

#[cfg(not(windows))]
fn main() {}
