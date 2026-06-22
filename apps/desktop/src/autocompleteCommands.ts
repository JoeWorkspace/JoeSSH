export const terminalAutocompleteCommands = [
  "kubectl get pods", "kubectl get services", "kubectl get deployments", "kubectl logs", "kubectl exec -it",
  "docker ps", "docker logs", "docker exec -it", "docker compose up", "docker compose down",
  "systemctl status", "systemctl restart", "systemctl enable", "systemctl disable",
  "tail -f", "less", "grep -r", "find . -name", "awk '{print $1}'",
  "ssh -L", "scp -r", "rsync -avz", "curl -s", "wget -O",
  "df -h", "du -sh", "free -m", "top -bn1", "htop",
  "ps aux", "kill -9", "nohup", "screen -S", "tmux new -s",
  "git status", "git log --oneline", "git diff", "git pull", "git push",
  "nginx -t", "nginx -s reload", "journalctl -u", "dmesg | tail",
  "iptables -L", "netstat -tlnp", "ss -tlnp", "lsof -i",
  "cat /etc/hostname", "uname -a", "uptime", "whoami", "id",
  "chmod 755", "chown -R", "tar -xzf", "zip -r", "unzip",
] as const;
