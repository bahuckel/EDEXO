//! EDExoCompare-Client-CLI.exe: the console build on this PC only, opening the browser.
//!
//! It was a second 56 MB copy of the same Node server as EDExoCompare-Server-CLI.exe, started with other settings
//! (1.3.1, owner 2026-10-25: "add both to 1.3.1, use Rust"). Now it starts that server, the exe beside it, with what
//! the old client added (scripts/cliPack.mjs): --host 127.0.0.1 unless a --host / --lan / --local was given, and
//! --open; the server adds --port 7111 itself. The console is shared: Ctrl+C reaches the server, which shuts down
//! cleanly, and this waits for it and ends with its exit code.

use std::process::{Command, ExitCode};

#[cfg(windows)]
mod ctrl {
    type Handler = unsafe extern "system" fn(u32) -> i32;
    #[link(name = "kernel32")]
    extern "system" {
        fn SetConsoleCtrlHandler(handler: Option<Handler>, add: i32) -> i32;
    }
    unsafe extern "system" fn handled(_kind: u32) -> i32 {
        1
    }
    /// Ctrl+C is the server's to handle: this one only waits. A handler, not the ignore flag, which children inherit.
    pub fn leave_to_child() {
        unsafe {
            SetConsoleCtrlHandler(Some(handled), 1);
        }
    }
}

const SERVER: &str = "EDExoCompare-Server-CLI.exe";

fn main() -> ExitCode {
    let given: Vec<String> = std::env::args().skip(1).collect();
    let mut args = given.clone();
    if !given.iter().any(|a| a == "--host" || a == "--lan" || a == "--local") {
        args.push("--host".into());
        args.push("127.0.0.1".into());
    }
    if !given.iter().any(|a| a == "--open") {
        args.push("--open".into());
    }
    let here = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_path_buf()));
    let Some(server) = here.map(|d| d.join(SERVER)).filter(|p| p.exists()) else {
        eprintln!("{SERVER} is not in this folder. Keep the two .exe files, \"web\" and \"data\" together.");
        return ExitCode::from(1);
    };
    #[cfg(windows)]
    ctrl::leave_to_child();
    match Command::new(&server).args(&args).status() {
        Ok(s) => ExitCode::from(s.code().unwrap_or(1).clamp(0, 255) as u8),
        Err(e) => {
            eprintln!("Could not start {SERVER}: {e}");
            ExitCode::from(1)
        }
    }
}
