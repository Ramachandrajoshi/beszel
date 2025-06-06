package agent

import (
	"beszel/internal/common"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net"
	"os"
	"strings"

	"github.com/gliderlabs/ssh"
	gossh "golang.org/x/crypto/ssh"
)

// CommandRequest defines the structure for incoming commands
type CommandRequest struct {
	Command string          `json:"command"`
	Params  json.RawMessage `json:"params"`
}

// LogParams defines the structure for "get_logs" command parameters
type LogParams struct {
	ContainerID string `json:"container_id"`
	Tail        int    `json:"tail"`
}

// CommandResponse defines the structure for responses
type CommandResponse struct {
	Data  interface{} `json:"data,omitempty"`
	Error string      `json:"error,omitempty"`
}

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
	slog.Debug("New session", "client", s.RemoteAddr())

	input, err := io.ReadAll(s.Stdin())
	if err != nil {
		slog.Error("Failed to read stdin", "err", err)
		s.Exit(1)
		return
	}

	var request CommandRequest
	// If there's no input or it's not a valid JSON, default to get_stats
	if len(input) == 0 {
		request.Command = "get_stats"
	} else {
		if err := json.Unmarshal(input, &request); err != nil {
			// If unmarshalling fails, assume it's a legacy client or an error, default to get_stats
			slog.Debug("Failed to unmarshal request, defaulting to get_stats", "err", err, "input", string(input))
			request.Command = "get_stats" // Or handle as an error explicitly if preferred
		}
	}

	if request.Command == "" { // Explicitly treat empty command as get_stats
		request.Command = "get_stats"
	}

	switch request.Command {
	case "get_stats":
		stats := a.gatherStats(s.Context().SessionID())
		response := CommandResponse{Data: stats}
		if err := json.NewEncoder(s).Encode(response); err != nil {
			slog.Error("Error encoding stats response", "err", err)
			s.Exit(1)
			return
		}
		s.Exit(0)
	case "get_logs":
		var params LogParams
		if err := json.Unmarshal(request.Params, &params); err != nil {
			slog.Error("Failed to unmarshal log params", "err", err)
			response := CommandResponse{Error: "invalid log parameters"}
			if encErr := json.NewEncoder(s).Encode(response); encErr != nil {
				slog.Error("Failed to encode error response for log params", "err", encErr)
			}
			s.Exit(1)
			return
		}

		if params.ContainerID == "" {
			response := CommandResponse{Error: "container_id is required"}
			if encErr := json.NewEncoder(s).Encode(response); encErr != nil {
				slog.Error("Failed to encode error response for missing container_id", "err", encErr)
			}
			s.Exit(1)
			return
		}

		if params.Tail <= 0 {
			params.Tail = 100 // Default to 100 lines
		}

		logsContent, err := a.dockerManager.GetContainerLogs(params.ContainerID, params.Tail)
		if err != nil {
			slog.Error("Failed to get container logs", "err", err, "container_id", params.ContainerID)
			response := CommandResponse{Error: fmt.Sprintf("failed to get container logs: %v", err)}
			if encErr := json.NewEncoder(s).Encode(response); encErr != nil {
				slog.Error("Failed to encode error response for GetContainerLogs", "err", encErr)
			}
			s.Exit(1)
			return
		}

		response := CommandResponse{Data: map[string]string{"logs": logsContent}}
		if err := json.NewEncoder(s).Encode(response); err != nil {
			slog.Error("Error encoding logs response", "err", err)
			s.Exit(1)
			return
		}
		s.Exit(0)
	default:
		slog.Warn("Unknown command received", "command", request.Command)
		response := CommandResponse{Error: fmt.Sprintf("unknown command: %s", request.Command)}
		if err := json.NewEncoder(s).Encode(response); err != nil {
			slog.Error("Error encoding unknown command response", "err", err)
		}
		s.Exit(1)
	}
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
