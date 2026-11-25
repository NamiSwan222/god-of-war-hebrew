//! Tirgumim proxy `version.dll` for God of War (2018, PC, Steam 1593500).
//!
//! `GoW.exe` imports `VERSION.dll`. Windows loads a DLL of that name from the game folder before
//! System32 (it is not a KnownDLL), so this file is loaded into the game on every start.
//! All 17 `version.dll` functions jump straight to the real System32 DLL.
//!
//! It changes nothing unless the game was started with the argument `-tirgumim-he` (the Tirgumim
//! launcher runs `steam -applaunch 1593500 -tirgumim-he`; a direct start of GoW.exe restarts
//! itself through Steam and loses environment variables) or with `TIRGUMIM_LANG=he`, and
//! `<game folder>\tirgumim\he\r_lang_en.wad` (or `%TIRGUMIM_DATA_DIR%\r_lang_en.wad`) exists.
//! Only then it redirects every open of a file named `r_lang_en.wad` to that Hebrew copy.
//! The game does not open its .wad files through its own import table, so the redirect sits in
//! ntdll (`NtCreateFile`, `NtOpenFile`, `NtQueryAttributesFile`, `NtQueryFullAttributesFile`):
//! each syscall stub is copied to a trampoline and its start replaced by a jump to our hook.
//! With a `debug.txt` in the data dir (or `TIRGUMIM_LOG=1`) every `.wad` path is logged to
//! `<data dir>\proxy.log`.
#![allow(non_snake_case, non_upper_case_globals, static_mut_refs, clippy::missing_safety_doc)]

use core::ffi::c_void;
use core::ptr::null_mut;
use core::sync::atomic::{AtomicUsize, Ordering};
use std::cell::Cell;

type Bool = i32;
type Handle = *mut c_void;
type NtStatus = i32;

#[link(name = "kernel32")]
extern "system" {
    fn GetEnvironmentVariableW(name: *const u16, buf: *mut u16, size: u32) -> u32;
    fn GetCommandLineW() -> *const u16;
    fn GetModuleHandleW(name: *const u16) -> Handle;
    fn GetModuleFileNameW(module: Handle, buf: *mut u16, size: u32) -> u32;
    fn GetFileAttributesW(path: *const u16) -> u32;
    fn VirtualProtect(addr: *mut c_void, size: usize, new: u32, old: *mut u32) -> Bool;
    fn VirtualAlloc(addr: *mut c_void, size: usize, kind: u32, protect: u32) -> *mut c_void;
    fn FlushInstructionCache(process: Handle, addr: *const c_void, size: usize) -> Bool;
    fn GetCurrentProcess() -> Handle;
    fn GetSystemDirectoryW(buf: *mut u16, size: u32) -> u32;
    fn LoadLibraryW(name: *const u16) -> Handle;
    fn GetProcAddress(module: Handle, name: *const u8) -> *mut c_void;
    fn CreateFileW(path: *const u16, access: u32, share: u32, sa: *mut c_void, disp: u32, flags: u32, tmpl: Handle) -> Handle;
    fn WriteFile(h: Handle, buf: *const u8, len: u32, written: *mut u32, ov: *mut c_void) -> Bool;
    fn CloseHandle(h: Handle) -> Bool;
    fn WideCharToMultiByte(cp: u32, flags: u32, w: *const u16, wn: i32, s: *mut u8, n: i32, d: *const u8, u: *mut Bool) -> i32;
}

// ---------------------------------------------------------------- version.dll forwarding

macro_rules! forward {
    ($($name:ident),* $(,)?) => {
        mod real {
            $(pub static mut $name: usize = 0;)*
        }
        $(
            #[unsafe(naked)]
            #[no_mangle]
            pub unsafe extern "system" fn $name() {
                core::arch::naked_asm!("jmp qword ptr [rip + {0}]", sym real::$name);
            }
        )*
        unsafe fn names() -> [(&'static [u8], *mut usize); 17] {
            [$((concat!(stringify!($name), "\0").as_bytes(), &raw mut real::$name)),*]
        }
    };
}

forward!(
    GetFileVersionInfoA, GetFileVersionInfoByHandle, GetFileVersionInfoExA, GetFileVersionInfoExW,
    GetFileVersionInfoSizeA, GetFileVersionInfoSizeExA, GetFileVersionInfoSizeExW, GetFileVersionInfoSizeW,
    GetFileVersionInfoW, VerFindFileA, VerFindFileW, VerInstallFileA, VerInstallFileW,
    VerLanguageNameA, VerLanguageNameW, VerQueryValueA, VerQueryValueW,
);

fn w(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}

unsafe fn load_real_version() {
    let mut path = [0u16; 600];
    let n = GetSystemDirectoryW(path.as_mut_ptr(), 560) as usize;
    if n == 0 || n >= 560 {
        return;
    }
    for (i, c) in w("\\version.dll\0").into_iter().enumerate() {
        path[n + i] = c;
    }
    let m = LoadLibraryW(path.as_ptr());
    if m.is_null() {
        return;
    }
    for (name, slot) in names() {
        core::ptr::write_volatile(slot, GetProcAddress(m, name.as_ptr()) as usize);
    }
}

// ---------------------------------------------------------------- redirect

const TARGET: &str = "r_lang_en.wad";
static mut HE_NT_PATH: Vec<u16> = Vec::new(); // \??\<data dir>\r_lang_en.wad, no NUL
static mut LOG_FILE: Vec<u16> = Vec::new(); // Win32 path, NUL-terminated; empty = no log

#[repr(C)]
struct UnicodeString {
    length: u16,
    max_length: u16,
    buffer: *mut u16,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct ObjectAttributes {
    length: u32,
    root: Handle,
    name: *mut UnicodeString,
    attributes: u32,
    security: *mut c_void,
    qos: *mut c_void,
}

thread_local! {
    static IN_LOG: Cell<bool> = const { Cell::new(false) };
}

fn lower(c: u16) -> u16 {
    if (b'A' as u16..=b'Z' as u16).contains(&c) { c + 32 } else { c }
}

fn ends_with_ci(s: &[u16], suffix: &[u16]) -> bool {
    s.len() >= suffix.len() && s[s.len() - suffix.len()..].iter().zip(suffix).all(|(a, b)| lower(*a) == lower(*b))
}

unsafe fn log_line(text: &[u16]) {
    if LOG_FILE.is_empty() || IN_LOG.with(|f| f.get()) {
        return;
    }
    IN_LOG.with(|f| f.set(true));
    // FILE_APPEND_DATA, share read/write, OPEN_ALWAYS
    let h = CreateFileW(LOG_FILE.as_ptr(), 4, 3, null_mut(), 4, 0x80, null_mut());
    if h as isize != -1 {
        let mut utf8 = vec![0u8; text.len() * 3 + 2];
        let n = WideCharToMultiByte(65001, 0, text.as_ptr(), text.len() as i32, utf8.as_mut_ptr(), utf8.len() as i32, core::ptr::null(), null_mut()) as usize;
        utf8.truncate(n);
        utf8.extend_from_slice(b"\r\n");
        let mut written = 0u32;
        WriteFile(h, utf8.as_ptr(), utf8.len() as u32, &mut written, null_mut());
        CloseHandle(h);
    }
    IN_LOG.with(|f| f.set(false));
}

/// Calls `f` with attributes pointing at the Hebrew file when `oa` names r_lang_en.wad.
unsafe fn with_redirect<R>(oa: *mut ObjectAttributes, what: &str, f: impl FnOnce(*mut ObjectAttributes) -> R) -> R {
    if oa.is_null() || (*oa).name.is_null() || (*(*oa).name).buffer.is_null() {
        return f(oa);
    }
    let name = &*(*oa).name;
    let path = core::slice::from_raw_parts(name.buffer, (name.length / 2) as usize);
    let is_wad = ends_with_ci(path, &w(".wad"));
    let base_start = path.iter().rposition(|&c| c == b'\\' as u16 || c == b'/' as u16).map_or(0, |i| i + 1);
    let base = &path[base_start..];
    let target = w(TARGET);
    let hit = base.len() == target.len() && ends_with_ci(base, &target);
    if is_wad {
        let mut line = w(if hit { "-> he " } else { "   " });
        line.extend_from_slice(&w(what));
        line.push(b' ' as u16);
        line.extend_from_slice(path);
        log_line(&line);
    }
    if !hit {
        return f(oa);
    }
    let mut us = UnicodeString {
        length: (HE_NT_PATH.len() * 2) as u16,
        max_length: (HE_NT_PATH.len() * 2) as u16,
        buffer: HE_NT_PATH.as_mut_ptr(),
    };
    let mut copy = *oa;
    copy.root = null_mut();
    copy.name = &mut us;
    f(&mut copy)
}

static T_CREATE: AtomicUsize = AtomicUsize::new(0);
static T_OPEN: AtomicUsize = AtomicUsize::new(0);
static T_QATTR: AtomicUsize = AtomicUsize::new(0);
static T_QFULL: AtomicUsize = AtomicUsize::new(0);

type NtCreateFileFn = unsafe extern "system" fn(*mut Handle, u32, *mut ObjectAttributes, *mut c_void, *mut i64, u32, u32, u32, u32, *mut c_void, u32) -> NtStatus;
type NtOpenFileFn = unsafe extern "system" fn(*mut Handle, u32, *mut ObjectAttributes, *mut c_void, u32, u32) -> NtStatus;
type NtQueryAttrFn = unsafe extern "system" fn(*mut ObjectAttributes, *mut c_void) -> NtStatus;

unsafe extern "system" fn hook_create(h: *mut Handle, acc: u32, oa: *mut ObjectAttributes, io: *mut c_void, alloc: *mut i64, attr: u32, share: u32, disp: u32, opts: u32, ea: *mut c_void, ealen: u32) -> NtStatus {
    let real: NtCreateFileFn = core::mem::transmute(T_CREATE.load(Ordering::Relaxed));
    with_redirect(oa, "NtCreateFile", |oa| real(h, acc, oa, io, alloc, attr, share, disp, opts, ea, ealen))
}

unsafe extern "system" fn hook_open(h: *mut Handle, acc: u32, oa: *mut ObjectAttributes, io: *mut c_void, share: u32, opts: u32) -> NtStatus {
    let real: NtOpenFileFn = core::mem::transmute(T_OPEN.load(Ordering::Relaxed));
    with_redirect(oa, "NtOpenFile", |oa| real(h, acc, oa, io, share, opts))
}

unsafe extern "system" fn hook_qattr(oa: *mut ObjectAttributes, info: *mut c_void) -> NtStatus {
    let real: NtQueryAttrFn = core::mem::transmute(T_QATTR.load(Ordering::Relaxed));
    with_redirect(oa, "NtQueryAttributesFile", |oa| real(oa, info))
}

unsafe extern "system" fn hook_qfull(oa: *mut ObjectAttributes, info: *mut c_void) -> NtStatus {
    let real: NtQueryAttrFn = core::mem::transmute(T_QFULL.load(Ordering::Relaxed));
    with_redirect(oa, "NtQueryFullAttributesFile", |oa| real(oa, info))
}

/// True when the command line has the whole-word argument `-tirgumim-he` (any case).
unsafe fn has_arg() -> bool {
    let cl = GetCommandLineW();
    if cl.is_null() {
        return false;
    }
    let mut n = 0;
    while *cl.add(n) != 0 {
        n += 1;
    }
    let line: Vec<u16> = core::slice::from_raw_parts(cl, n).iter().map(|&c| lower(c)).collect();
    let arg = w("-tirgumim-he");
    let sep = |c: Option<&u16>| c.map_or(true, |&c| c == b' ' as u16 || c == 9 || c == b'"' as u16);
    line.windows(arg.len()).enumerate().any(|(i, win)| win == arg.as_slice() && (i == 0 || sep(line.get(i - 1))) && sep(line.get(i + arg.len())))
}

unsafe fn env(name: &str) -> Option<Vec<u16>> {
    let n: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
    let mut buf = vec![0u16; 1024];
    let len = GetEnvironmentVariableW(n.as_ptr(), buf.as_mut_ptr(), 1024) as usize;
    if len == 0 || len >= 1024 {
        return None;
    }
    buf.truncate(len);
    Some(buf)
}

fn exists(path: &[u16]) -> bool {
    let z: Vec<u16> = path.iter().copied().chain(Some(0)).collect();
    unsafe { GetFileAttributesW(z.as_ptr()) != u32::MAX }
}

unsafe fn activate() {
    let env_he = env("TIRGUMIM_LANG").is_some_and(|v| v.iter().map(|&c| lower(c)).eq(w("he")));
    if !(has_arg() || env_he) {
        return; // not started by the Tirgumim launcher: stay inert
    }
    let mut dir = match env("TIRGUMIM_DATA_DIR") {
        Some(d) => d,
        None => {
            let mut buf = vec![0u16; 1024];
            let len = GetModuleFileNameW(null_mut(), buf.as_mut_ptr(), 1024) as usize;
            if len == 0 || len >= 1024 {
                return;
            }
            buf.truncate(len);
            let Some(slash) = buf.iter().rposition(|&c| c == b'\\' as u16 || c == b'/' as u16) else { return };
            buf.truncate(slash);
            buf.extend_from_slice(&w("\\tirgumim\\he"));
            buf
        }
    };
    while dir.last().is_some_and(|&c| c == b'\\' as u16 || c == b'/' as u16) {
        dir.pop();
    }
    let mut he_file = dir.clone();
    he_file.extend_from_slice(&w("\\"));
    he_file.extend_from_slice(&w(TARGET));
    if !exists(&he_file) {
        return; // Hebrew data missing: run the original game
    }
    HE_NT_PATH = w("\\??\\");
    HE_NT_PATH.extend_from_slice(&he_file);

    let mut debug = dir.clone();
    debug.extend_from_slice(&w("\\debug.txt"));
    if exists(&debug) || env("TIRGUMIM_LOG").is_some() {
        LOG_FILE = dir.clone();
        LOG_FILE.extend_from_slice(&w("\\proxy.log\0"));
    }

    let hooks: [(&[u8], usize, &AtomicUsize); 4] = [
        (b"NtCreateFile\0", hook_create as *const () as usize, &T_CREATE),
        (b"NtOpenFile\0", hook_open as *const () as usize, &T_OPEN),
        (b"NtQueryAttributesFile\0", hook_qattr as *const () as usize, &T_QATTR),
        (b"NtQueryFullAttributesFile\0", hook_qfull as *const () as usize, &T_QFULL),
    ];
    let mut installed = 0;
    for (name, hook, slot) in hooks {
        // Each 32-byte syscall stub is copied to an executable trampoline (it only uses absolute
        // addresses and jumps inside itself); the trampoline is stored before the stub is patched.
        let ntdll = GetModuleHandleW(w("ntdll.dll\0").as_ptr());
        let p = GetProcAddress(ntdll, name.as_ptr()) as *const u8;
        if p.is_null() || core::slice::from_raw_parts(p, 4) != [0x4c, 0x8b, 0xd1, 0xb8] {
            continue;
        }
        let tramp = VirtualAlloc(null_mut(), 64, 0x3000, 0x40) as *mut u8;
        if tramp.is_null() {
            continue;
        }
        core::ptr::copy_nonoverlapping(p, tramp, 32);
        slot.store(tramp as usize, Ordering::SeqCst);
        if hook_stub_with(p as *mut u8, hook) {
            installed += 1;
        }
    }
    log_line(&w(&format!("activated, {installed}/4 ntdll hooks")));
}

/// Writes `jmp [rip+0]; dq hook` over the start of `p`.
unsafe fn hook_stub_with(p: *mut u8, hook: usize) -> bool {
    let mut old = 0u32;
    if VirtualProtect(p as *mut c_void, 14, 0x40, &mut old) == 0 {
        return false;
    }
    let jump: [u8; 6] = [0xff, 0x25, 0, 0, 0, 0];
    core::ptr::copy_nonoverlapping(jump.as_ptr(), p, 6);
    core::ptr::write_unaligned(p.add(6) as *mut u64, hook as u64);
    VirtualProtect(p as *mut c_void, 14, old, &mut old);
    FlushInstructionCache(GetCurrentProcess(), p as *const c_void, 14);
    true
}

#[no_mangle]
pub unsafe extern "system" fn DllMain(_inst: Handle, reason: u32, _res: *mut c_void) -> Bool {
    if reason == 1 {
        load_real_version();
        activate();
    }
    1
}
