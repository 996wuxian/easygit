use std::{
    io::{self, Read},
    process::{Child, Command, Output, Stdio},
    sync::mpsc::{self, Receiver, TryRecvError},
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

fn read_pipe(mut pipe: impl Read + Send + 'static) -> Receiver<io::Result<Vec<u8>>> {
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = pipe.read_to_end(&mut bytes).map(|_| bytes);
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
    #[cfg(windows)]
    let process_job = ProcessJob::new()?;
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command.spawn()?;
    #[cfg(windows)]
    if let Err(error) = process_job.assign(&child) {
        stop_process_tree(&mut child);
        return Err(error);
    }
    let stdout_receiver = read_pipe(child.stdout.take().expect("stdout is piped"));
    let stderr_receiver = read_pipe(child.stderr.take().expect("stderr is piped"));
    let deadline = Instant::now() + timeout;
    let mut status = None;
    let mut stdout = None;
    let mut stderr = None;
    loop {
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
}
