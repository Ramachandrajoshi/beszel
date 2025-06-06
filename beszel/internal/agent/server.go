package agent

import (
	"beszel/internal/common"
	"beszel/internal/entities/container" // Required for ApiInfo
	"encoding/json"
	"flag" // For parsing flags within command strings
	"fmt"
	"io"
	"log/slog"
	"net"
	"os"
	"strings"
	"strconv" // For parsing boolean follow

	"github.com/gliderlabs/ssh"
	gossh "golang.org/x/crypto/ssh"
)

type ServerOptions struct {
	Addr    string
	Network string
	Keys    []gossh.PublicKey
}

func (a *Agent) StartServer(opts ServerOptions) error {
	slog.Info("Starting SSH server", "addr", opts.Addr, "network", opts.Network)

	if opts.Network == "unix" {
		// remove existing socket file if it exists
		if err := os.Remove(opts.Addr); err != nil && !os.IsNotExist(err) {
			return err
		}
	}

	// start listening on the address
	ln, err := net.Listen(opts.Network, opts.Addr)
	if err != nil {
		return err
	}
	defer ln.Close()

	// base config (limit to allowed algorithms)
	config := &gossh.ServerConfig{}
	config.KeyExchanges = common.DefaultKeyExchanges
	config.MACs = common.DefaultMACs
	config.Ciphers = common.DefaultCiphers

	// set default handler
	ssh.Handle(a.handleSession)

	server := ssh.Server{
		ServerConfigCallback: func(ctx ssh.Context) *gossh.ServerConfig {
			return config
		},
		// check public key(s)
		PublicKeyHandler: func(ctx ssh.Context, key ssh.PublicKey) bool {
			for _, pubKey := range opts.Keys {
				if ssh.KeysEqual(key, pubKey) {
					return true
				}
			}
			return false
		},
		// disable pty
		PtyCallback: func(ctx ssh.Context, pty ssh.Pty) bool {
			return false
		},
		// log failed connections
		ConnectionFailedCallback: func(conn net.Conn, err error) {
			slog.Warn("Failed connection attempt", "addr", conn.RemoteAddr().String(), "err", err)
		},
	}

	// Start SSH server on the listener
	return server.Serve(ln)
}

func (a *Agent) handleSession(s ssh.Session) {
	cmd := s.Command()
	args := strings.Fields(cmd) // Basic split, Hub will send "agent_cli get-docker-logs --id foo"
	sessionID := s.Context().SessionID()
	slog.Debug("New session", "client", s.RemoteAddr(), "command", cmd, "args", args, "sessionID", sessionID)

	var commandName string
	if len(args) > 0 {
		// Assuming the Hub might send "agent_cli <command>" or just "<command>"
		if args[0] == "agent_cli" && len(args) > 1 {
			commandName = args[1]
			args = args[2:] // Actual arguments for the command
		} else {
			// This case might occur if Hub sends command directly without "agent_cli" prefix
			// or if s.Command() is empty and args is empty.
			// For now, if not "agent_cli", assume the first word is the command if present.
			// If no command, it will fall through to default behavior.
			commandName = args[0]
			args = args[1:]
		}
	}

	slog.Debug("Parsed command", "name", commandName, "remaining_args", args)

	switch commandName {
	case "get-docker-containers":
		a.handleGetDockerContainers(s)
	case "get-docker-logs":
		a.handleGetDockerLogs(s, args)
	default:
		// Original behavior: stream all stats
		slog.Debug("Default handler: streaming all stats", "session", sessionID)
		stats := a.gatherStats(sessionID)
		if err := json.NewEncoder(s).Encode(stats); err != nil {
			slog.Error("Error encoding stats for default handler", "err", err)
			fmt.Fprintf(s.Stderr(), "Error encoding stats: %v\n", err)
			s.Exit(1)
			return
		}
		s.Exit(0)
	}
}

func (a *Agent) handleGetDockerContainers(s ssh.Session) {
	slog.Debug("Handling get-docker-containers", "session", s.Context().SessionID())
	if a.dockerManager == nil {
		slog.Error("Docker manager not initialized for get-docker-containers")
		fmt.Fprintln(s.Stderr(), "Docker manager not initialized")
		s.Exit(1)
		return
	}

	// getDockerStats populates apiContainerList and returns stats, we just need the side effect here
	// and then access the list.
	if _, err := a.dockerManager.getDockerStats(); err != nil {
		slog.Error("Error calling getDockerStats", "err", err)
		fmt.Fprintf(s.Stderr(), "Error getting Docker stats: %v\n", err)
		s.Exit(1)
		return
	}

	// Ensure apiContainerList is not nil before marshalling
	var containerList []*container.ApiInfo
	if a.dockerManager.apiContainerList != nil {
		containerList = a.dockerManager.apiContainerList
	} else {
		// Return an empty JSON array if nil, rather than `null`
		containerList = make([]*container.ApiInfo, 0)
	}


	jsonData, err := json.Marshal(containerList)
	if err != nil {
		slog.Error("Error marshalling container list to JSON", "err", err)
		fmt.Fprintf(s.Stderr(), "Error marshalling container list: %v\n", err)
		s.Exit(1)
		return
	}

	if _, err := s.Write(jsonData); err != nil {
		slog.Error("Error writing JSON container list to session", "err", err)
		// Exit code might have already been set or stream closed
	}
	s.Exit(0)
}

func (a *Agent) handleGetDockerLogs(s ssh.Session, args []string) {
	slog.Debug("Handling get-docker-logs", "session", s.Context().SessionID(), "args", args)
	if a.dockerManager == nil {
		slog.Error("Docker manager not initialized for get-docker-logs")
		fmt.Fprintln(s.Stderr(), "Docker manager not initialized")
		s.Exit(1)
		return
	}

	// Use flag package for parsing args for this specific command
	logFlags := flag.NewFlagSet("get-docker-logs", flag.ContinueOnError)
	logFlags.SetOutput(s.Stderr()) // Send flag parsing errors to session stderr

	var containerID, since, tail string

	logFlags.StringVar(&containerID, "id", "", "Container ID (required)")
	logFlags.StringVar(&since, "since", "", "Timestamp (e.g., YYYY-MM-DDTHH:MM:SSZ or seconds)")
	logFlags.StringVar(&tail, "tail", "", "Number of lines from the end of the logs to show")
	// flag.BoolVar cannot directly parse "--follow" without "=true" from strings.Fields.
	// We'll handle "follow" presence manually or require "--follow=true".
	// For simplicity, let's check for "--follow" presence.
	// A more robust solution might be custom parsing or a small helper for boolean flags without values.

	if err := logFlags.Parse(args); err != nil {
		slog.Error("Error parsing flags for get-docker-logs", "err", err)
		// Error message already sent to s.Stderr() by logFlags.SetOutput
		s.Exit(1)
		return
	}

	if containerID == "" {
		slog.Error("Container ID (--id) is required for get-docker-logs")
		fmt.Fprintln(s.Stderr(), "Container ID (--id) is required")
		logFlags.Usage()
		s.Exit(1)
		return
	}

	slog.Debug("Calling dockerManager.getContainerLogs", "id", containerID, "since", since, "tail", tail)
	logStream, err := a.dockerManager.getContainerLogs(containerID, since, tail)
	if err != nil {
		slog.Error("Error getting container logs from dockerManager", "err", err, "id", containerID)
		fmt.Fprintf(s.Stderr(), "Error getting container logs for %s: %v\n", containerID, err)
		s.Exit(1)
		return
	}
	defer logStream.Close()

	// Copy the stream to the SSH session's stdout
	// The SSH library and client (Hub) must support this.
	written, err := io.Copy(s, logStream)
	if err != nil {
		slog.Error("Error streaming logs to session", "err", err, "id", containerID, "written_bytes", written)
		// Don't write to s.Stderr() here as the stream might be compromised or headers sent.
		// The error will be logged, and the session will eventually close.
		s.Exit(1) // Ensure exit code is non-zero if copy fails.
		return
	}

	slog.Debug("Successfully streamed logs", "id", containerID, "written_bytes", written)
	s.Exit(0)
}


// ParseKeys parses a string containing SSH public keys in authorized_keys format.
// It returns a slice of ssh.PublicKey and an error if any key fails to parse.
func ParseKeys(input string) ([]gossh.PublicKey, error) {
	var parsedKeys []gossh.PublicKey
	for line := range strings.Lines(input) {
		line = strings.TrimSpace(line)
		// Skip empty lines or comments
		if len(line) == 0 || strings.HasPrefix(line, "#") {
			continue
		}
		// Parse the key
		parsedKey, _, _, _, err := gossh.ParseAuthorizedKey([]byte(line))
		if err != nil {
			return nil, fmt.Errorf("failed to parse key: %s, error: %w", line, err)
		}
		parsedKeys = append(parsedKeys, parsedKey)
	}
	return parsedKeys, nil
}

// GetAddress gets the address to listen on or connect to from environment variables or default value.
func GetAddress(addr string) string {
	if addr == "" {
		addr, _ = GetEnv("LISTEN")
	}
	if addr == "" {
		// Legacy PORT environment variable support
		addr, _ = GetEnv("PORT")
	}
	if addr == "" {
		return ":45876"
	}
	// prefix with : if only port was provided
	if GetNetwork(addr) != "unix" && !strings.Contains(addr, ":") {
		addr = ":" + addr
	}
	return addr
}

// GetNetwork returns the network type to use based on the address
func GetNetwork(addr string) string {
	if network, ok := GetEnv("NETWORK"); ok && network != "" {
		return network
	}
	if strings.HasPrefix(addr, "/") {
		return "unix"
	}
	return "tcp"
}
