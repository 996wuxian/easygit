use std::{
    io::{self, Read},
    process::{Child, Command, Output, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, TryRecvError},
    },
    thread,
    time::{Duration, Instant},
};

#[cfg(windows)]
struct ProcessJob(windows_sys::Win32::Foundation::HANDLE);

#[cfg(windows)]
impl ProcessJob {
    fn new() -> io::Result<Self> {
        use windows_sys::Win32::System::JobObjects::{
            CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        };
        // An unnamed job is private to this command. Closing its sole handle
        // terminates its descendants even if taskkill is unavailable/denied.
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle.is_null() {
            return Err(io::Error::last_os_error());
        }
        let job = Self(handle);
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let success = unsafe {
            SetInformationJobObject(
                job.0,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const std::ffi::c_void,
                std::mem::size_of_val(&limits) as u32,
            )
        };
        if success == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(job)
    }

    fn assign(&self, child: &Child) -> io::Result<()> {
        use std::os::windows::io::AsRawHandle;
        let success = unsafe {
            windows_sys::Win32::System::JobObjects::AssignProcessToJobObject(
                self.0,
                child.as_raw_handle(),
            )
        };
        if success == 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    }
}

#[cfg(windows)]
impl Drop for ProcessJob {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0);
        }
    }
}

const DEFAULT_STDOUT_LIMIT: usize = 64 * 1024 * 1024;
const DEFAULT_STDERR_LIMIT: usize = 1024 * 1024;

#[derive(Clone, Copy)]
enum PipeLimit {
    Reject(usize),
    Prefix(usize),
}

fn read_pipe(
    mut pipe: impl Read + Send + 'static,
    limit: PipeLimit,
) -> Receiver<io::Result<Vec<u8>>> {
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = match limit {
            PipeLimit::Reject(limit) => {
                // Read one extra byte to distinguish an exact fit from overflow.
                pipe.take(limit.saturating_add(1) as u64)
                    .read_to_end(&mut bytes)
                    .and_then(|_| {
                        if bytes.len() > limit {
                            Err(io::Error::new(
                                io::ErrorKind::InvalidData,
                                format!("Git 输出超过允许的大小（{limit} 字节），已停止本次任务。操作可能已部分完成，请刷新仓库状态后再继续。"),
                            ))
                        } else {
                            Ok(bytes)
                        }
                    })
            }
            PipeLimit::Prefix(limit) => {
                // Preserve a prefix for callers that deliberately truncate,
                // but drain the rest so the child can exit and report errors.
                (&mut pipe)
                    .take(limit as u64)
                    .read_to_end(&mut bytes)
                    .and_then(|_| io::copy(&mut pipe, &mut io::sink()))
                    .map(|_| bytes)
            }
        };
        let _ = sender.send(result);
    });
    receiver
}

fn receive_pipe(receiver: &Receiver<io::Result<Vec<u8>>>) -> io::Result<Option<Vec<u8>>> {
    match receiver.try_recv() {
        Ok(result) => result.map(Some),
        Err(TryRecvError::Empty) => Ok(None),
        Err(TryRecvError::Disconnected) => Err(io::Error::other("无法读取 Git 输出。")),
    }
}

fn stop_process_tree(child: &mut Child) {
    // Do not target a PID after the child has already exited: it may be reused.
    // The Windows job handle still cleans up any remaining descendants on drop.
    if matches!(child.try_wait(), Ok(Some(_))) {
        return;
    }
    // Terminate the tree before the root: Git may be waiting on SSH or a hook.
    // Only the PID returned by our own Command::spawn is ever targeted.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut killer = Command::new("taskkill");
        killer
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(0x08000000);
        if let Ok(mut killer) = killer.spawn() {
            let deadline = Instant::now() + Duration::from_secs(2);
            loop {
                if matches!(killer.try_wait(), Ok(Some(_))) {
                    break;
                }
                if Instant::now() >= deadline {
                    let _ = killer.kill();
                    break;
                }
                thread::sleep(Duration::from_millis(10));
            }
        }
    }
    let _ = child.kill();
    let deadline = Instant::now() + Duration::from_secs(1);
    while !matches!(child.try_wait(), Ok(Some(_))) && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(10));
    }
}

/// Drain both output pipes concurrently and enforce a deadline for process and
/// pipe completion. A descendant holding an inherited pipe cannot block the UI.
pub fn output_with_timeout(command: &mut Command, timeout: Duration) -> io::Result<Output> {
    output_with_limit(command, timeout, DEFAULT_STDOUT_LIMIT, DEFAULT_STDERR_LIMIT)
}

/// Bound both output streams independently while retaining the timeout and
/// process-tree cleanup used for all Git commands.
pub fn output_with_limit(
    command: &mut Command,
    timeout: Duration,
    stdout_limit: usize,
    stderr_limit: usize,
) -> io::Result<Output> {
    output_with_policy(
        command,
        timeout,
        PipeLimit::Reject(stdout_limit),
        stderr_limit,
        None,
    )
}

pub fn output_with_prefix(
    command: &mut Command,
    timeout: Duration,
    stdout_prefix: usize,
    stderr_limit: usize,
) -> io::Result<Output> {
    output_with_policy(
        command,
        timeout,
        PipeLimit::Prefix(stdout_prefix),
        stderr_limit,
        None,
    )
}

/// Cancellable read-only tasks retain the same output limits, deadline and
/// Windows job cleanup, without waiting for the normal process timeout.
pub fn output_with_cancellation(
    command: &mut Command,
    timeout: Duration,
    stdout_limit: usize,
    stderr_limit: usize,
    cancelled: &AtomicBool,
) -> io::Result<Output> {
    output_with_policy(
        command,
        timeout,
        PipeLimit::Reject(stdout_limit),
        stderr_limit,
        Some(cancelled),
    )
}

fn output_with_policy(
    command: &mut Command,
    timeout: Duration,
    stdout_limit: PipeLimit,
    stderr_limit: usize,
    cancelled: Option<&AtomicBool>,
) -> io::Result<Output> {
    if cancelled.is_some_and(|flag| flag.load(Ordering::Relaxed)) {
        return Err(io::Error::new(io::ErrorKind::Interrupted, "搜索已取消。"));
    }
    #[cfg(windows)]
    let process_job = ProcessJob::new()?;
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command.spawn()?;
    #[cfg(windows)]
    if let Err(error) = process_job.assign(&child) {
        stop_process_tree(&mut child);
        return Err(error);
    }
    let stdout_receiver = read_pipe(child.stdout.take().expect("stdout is piped"), stdout_limit);
    let stderr_receiver = read_pipe(
        child.stderr.take().expect("stderr is piped"),
        PipeLimit::Reject(stderr_limit),
    );
    let deadline = Instant::now() + timeout;
    let mut status = None;
    let mut stdout = None;
    let mut stderr = None;
    loop {
        if cancelled.is_some_and(|flag| flag.load(Ordering::Relaxed)) {
            stop_process_tree(&mut child);
            return Err(io::Error::new(io::ErrorKind::Interrupted, "搜索已取消。"));
        }
        let poll = (|| -> io::Result<()> {
            if status.is_none() {
                status = child.try_wait()?;
            }
            if stdout.is_none() {
                stdout = receive_pipe(&stdout_receiver)?;
            }
            if stderr.is_none() {
                stderr = receive_pipe(&stderr_receiver)?;
            }
            Ok(())
        })();
        if let Err(error) = poll {
            stop_process_tree(&mut child);
            return Err(error);
        }
        if let (Some(status), Some(stdout), Some(stderr)) =
            (status, stdout.as_mut(), stderr.as_mut())
        {
            return Ok(Output {
                status,
                stdout: std::mem::take(stdout),
                stderr: std::mem::take(stderr),
            });
        }
        if Instant::now() >= deadline {
            stop_process_tree(&mut child);
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "Git 操作超时，已停止本次任务。操作可能已部分完成，请刷新仓库状态后再继续。",
            ));
        }
        thread::sleep(Duration::from_millis(10));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn fixture() {
        match std::env::var("ESAYGIT_PROCESS_TEST").as_deref() {
            Ok("sleep") => thread::sleep(Duration::from_secs(20)),
            Ok("pipes") => {
                io::stdout().write_all(&vec![b'x'; 256 * 1024]).unwrap();
                io::stderr().write_all(&vec![b'y'; 256 * 1024]).unwrap();
            }
            Ok("stdout-overflow") => {
                io::stdout().write_all(&vec![b'x'; 256 * 1024]).ok();
                thread::sleep(Duration::from_secs(20));
            }
            Ok("stderr-overflow") => {
                io::stderr().write_all(&vec![b'y'; 256 * 1024]).ok();
                thread::sleep(Duration::from_secs(20));
            }
            #[cfg(windows)]
            Ok("tree") => {
                let mut child = fixture_command("leaf").spawn().unwrap();
                child.wait().unwrap();
            }
            #[cfg(windows)]
            Ok("leaf") => {
                let marker = std::env::var("ESAYGIT_PROCESS_MARKER").unwrap();
                std::fs::write(format!("{marker}.started"), "started").unwrap();
                thread::sleep(Duration::from_secs(1));
                std::fs::write(marker, "still running").unwrap();
                thread::sleep(Duration::from_secs(20));
            }
            _ => {}
        }
    }

    fn fixture_command(mode: &str) -> Command {
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args(["--exact", "process::tests::fixture", "--nocapture"])
            .env("ESAYGIT_PROCESS_TEST", mode)
            .stdin(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        command
    }

    #[test]
    fn sleeping_child_times_out_without_waiting_for_its_natural_exit() {
        let started = Instant::now();
        let error = output_with_timeout(&mut fixture_command("sleep"), Duration::from_millis(100))
            .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
        assert!(error.to_string().contains("刷新仓库状态"));
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn large_stdout_and_stderr_are_drained_without_pipe_deadlock() {
        let result =
            output_with_timeout(&mut fixture_command("pipes"), Duration::from_secs(5)).unwrap();
        assert!(result.status.success());
        assert!(result.stdout.len() >= 256 * 1024);
        assert!(result.stderr.len() >= 256 * 1024);
    }

    #[test]
    fn pipe_limit_accepts_exact_size_and_rejects_one_extra_byte() {
        for (length, succeeds) in [(1024, true), (1025, false)] {
            let receiver = read_pipe(io::Cursor::new(vec![b'x'; length]), PipeLimit::Reject(1024));
            let result = receiver.recv().unwrap();
            assert_eq!(result.is_ok(), succeeds);
            if !succeeds {
                assert_eq!(result.unwrap_err().kind(), io::ErrorKind::InvalidData);
            }
        }
    }

    #[test]
    fn prefix_mode_drains_large_output_and_preserves_process_status() {
        let result = output_with_prefix(
            &mut fixture_command("pipes"),
            Duration::from_secs(5),
            1024,
            512 * 1024,
        )
        .unwrap();
        assert!(result.status.success());
        assert_eq!(result.stdout.len(), 1024);
        assert!(result.stderr.len() >= 256 * 1024);
    }

    #[test]
    fn oversized_stdout_and_stderr_stop_the_child_promptly() {
        for mode in ["stdout-overflow", "stderr-overflow"] {
            let started = Instant::now();
            let error = output_with_limit(
                &mut fixture_command(mode),
                Duration::from_secs(10),
                32 * 1024,
                32 * 1024,
            )
            .unwrap_err();
            assert_eq!(error.kind(), io::ErrorKind::InvalidData, "{mode}");
            assert!(error.to_string().contains("超过允许的大小"));
            assert!(started.elapsed() < Duration::from_secs(5), "{mode}");
        }
    }

    #[cfg(windows)]
    #[test]
    fn timeout_stops_descendants_of_the_owned_child() {
        let directory = tempfile::tempdir().unwrap();
        let marker = directory.path().join("leaf-was-not-stopped");
        let mut command = fixture_command("tree");
        command.env("ESAYGIT_PROCESS_MARKER", &marker);
        let error = output_with_timeout(&mut command, Duration::from_millis(500)).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
        assert!(std::path::Path::new(&format!("{}.started", marker.display())).exists());
        thread::sleep(Duration::from_millis(1200));
        assert!(
            !marker.exists(),
            "the descendant must not survive the timeout"
        );
    }

    #[test]
    fn cancellation_stops_a_running_child_without_waiting_for_its_timeout() {
        let cancelled = std::sync::Arc::new(AtomicBool::new(false));
        let worker_flag = cancelled.clone();
        let started = Instant::now();
        let worker = thread::spawn(move || {
            output_with_cancellation(
                &mut fixture_command("sleep"),
                Duration::from_secs(20),
                1024,
                1024,
                &worker_flag,
            )
        });
        thread::sleep(Duration::from_millis(80));
        cancelled.store(true, Ordering::Relaxed);
        let error = worker.join().unwrap().unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::Interrupted);
        assert!(started.elapsed() < Duration::from_secs(3));
    }
}
