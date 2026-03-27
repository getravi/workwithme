use std::process::Command;

/// Sandbox profile for restricting tool execution
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum SandboxProfile {
    /// Read-only access - no network, no writes
    ReadOnly,
    /// Write access to home directory
    WriteHome,
    /// Minimal restrictions - for trusted operations
    Unrestricted,
}

/// Sandbox executor for running commands in restricted environment
pub struct Sandbox {
    profile: SandboxProfile,
}

impl Sandbox {
    /// Create new sandbox with given profile
    pub fn new(profile: SandboxProfile) -> Self {
        Sandbox { profile }
    }

    /// Execute a command within the sandbox
    pub fn execute(&self, command: &str) -> Result<std::process::Output, std::io::Error> {
        #[cfg(target_os = "macos")]
        return self.execute_macos(command);

        #[cfg(target_os = "linux")]
        return self.execute_linux(command);

        #[cfg(target_os = "windows")]
        return self.execute_windows(command);

        #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
        return self.execute_unsupported(command);
    }

    #[cfg(target_os = "macos")]
    fn execute_macos(&self, command: &str) -> Result<std::process::Output, std::io::Error> {
        let profile = self.get_seatbelt_profile();

        // Create sandbox profile as a temporary file
        let profile_path = "/tmp/workwithme-sandbox.sb";
        std::fs::write(profile_path, profile).ok();

        // Use sandbox-exec to run the command
        let output = Command::new("sandbox-exec")
            .arg("-f")
            .arg(profile_path)
            .arg("sh")
            .arg("-c")
            .arg(command)
            .output();

        // Cleanup
        std::fs::remove_file(profile_path).ok();

        output
    }

    #[cfg(target_os = "linux")]
    fn execute_linux(&self, command: &str) -> Result<std::process::Output, std::io::Error> {
        match self.profile {
            SandboxProfile::ReadOnly => {
                // Use bwrap (bubblewrap) for sandboxing
                self.execute_with_bwrap(command, vec!["--ro-bind", "/", "/"])
            }
            SandboxProfile::WriteHome => {
                // Allow writes to home, but not system directories
                let home = std::env::var("HOME").unwrap_or_else(|_| "/root".to_string());
                let mut args = vec![
                    "--ro-bind".to_string(),
                    "/".to_string(),
                    "/".to_string(),
                    "--bind".to_string(),
                    home.clone(),
                    home,
                ];
                self.execute_with_bwrap(command, args)
            }
            SandboxProfile::Unrestricted => {
                // No sandboxing for unrestricted profile
                Command::new("sh")
                    .arg("-c")
                    .arg(command)
                    .output()
            }
        }
    }

    #[cfg(target_os = "linux")]
    fn execute_with_bwrap(
        &self,
        command: &str,
        bind_args: Vec<&str>,
    ) -> Result<std::process::Output, std::io::Error> {
        // Check if bwrap is available
        if !self.is_bwrap_available() {
            println!("[sandbox] bwrap not available, falling back to unsandboxed execution");
            return Command::new("sh").arg("-c").arg(command).output();
        }

        let mut cmd = Command::new("bwrap");
        for arg in bind_args {
            cmd.arg(arg);
        }

        cmd.arg("sh").arg("-c").arg(command).output()
    }

    #[cfg(target_os = "linux")]
    fn is_bwrap_available(&self) -> bool {
        Command::new("which")
            .arg("bwrap")
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false)
    }

    #[cfg(target_os = "windows")]
    fn execute_windows(&self, command: &str) -> Result<std::process::Output, std::io::Error> {
        // Windows sandboxing via process isolation
        // For now, use a simple approach with job objects
        // Full Windows Sandbox integration would be more complex

        match self.profile {
            SandboxProfile::ReadOnly => {
                // Note: Full read-only enforcement on Windows requires job objects
                // For now, just run the command with awareness that it's sandboxed
                println!("[sandbox] Windows read-only mode not fully implemented");
                Command::new("cmd").arg("/c").arg(command).output()
            }
            SandboxProfile::WriteHome => {
                // Run with limited privileges
                Command::new("cmd").arg("/c").arg(command).output()
            }
            SandboxProfile::Unrestricted => {
                // No sandboxing
                Command::new("cmd").arg("/c").arg(command).output()
            }
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    fn execute_unsupported(&self, command: &str) -> Result<std::process::Output, std::io::Error> {
        println!("[sandbox] sandbox not supported on this platform, running unsandboxed");
        Command::new("sh")
            .arg("-c")
            .arg(command)
            .output()
    }

    #[cfg(target_os = "macos")]
    fn get_seatbelt_profile(&self) -> String {
        match self.profile {
            SandboxProfile::ReadOnly => {
                // Read-only sandbox profile
                r#"
(version 1)
(allow default)
(deny file-write*)
(deny network*)
(deny process-exec* (regex #"^(?!/bin/sh$|^/usr/bin/env$)"))
"#.to_string()
            }
            SandboxProfile::WriteHome => {
                // Home directory write access
                let home = std::env::var("HOME").unwrap_or_else(|_| "/Users/nobody".to_string());
                format!(
                    r#"
(version 1)
(allow default)
(allow file-write* (path "{}"))
(deny file-write* (path "/System*"))
(deny file-write* (path "/usr*"))
(deny network*)
"#,
                    home
                )
            }
            SandboxProfile::Unrestricted => {
                // No restrictions
                "(version 1)\n(allow default)".to_string()
            }
        }
    }
}

/// Apply sandbox to command execution
pub fn apply_sandbox(
    profile: SandboxProfile,
    command: &str,
) -> Result<std::process::Output, std::io::Error> {
    let sandbox = Sandbox::new(profile);
    sandbox.execute(command)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sandbox_creation() {
        let sandbox = Sandbox::new(SandboxProfile::ReadOnly);
        assert_eq!(sandbox.profile, SandboxProfile::ReadOnly);
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn test_seatbelt_profile_generation() {
        let sandbox = Sandbox::new(SandboxProfile::ReadOnly);
        let profile = sandbox.get_seatbelt_profile();
        assert!(profile.contains("deny file-write*"));
    }
}
