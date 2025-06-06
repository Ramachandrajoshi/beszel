package agent

import (
	"crypto/ed25519"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"bytes"
	"context"
	"encoding/json"
	"io"
	// "log/slog" // Uncomment if specific slog behavior needs to be asserted or configured for tests

	"beszel/internal/entities/container" // Required for ApiInfo type

	gliderssh "github.com/gliderlabs/ssh" // Alias to avoid conflict with x/crypto/ssh
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/ssh"
)

// mockSSHSession implements ssh.Session for testing
type mockSSHSession struct {
	gliderssh.Session // Embed to get default implementations if any are added to interface
	cmd             string
	stdoutBuffer    bytes.Buffer
	stderrBuffer    bytes.Buffer
	exitCode        int
	env             map[string]string
	pty             gliderssh.Pty
	win             gliderssh.Window
	permissions     *gliderssh.Permissions
	sessCtx         context.Context // Use glider's context type if it has one, else std context
	sessID          string
}

func (m *mockSSHSession) Write(p []byte) (int, error) {
	return m.stdoutBuffer.Write(p)
}

func (m *mockSSHSession) Stderr() io.ReadWriter {
	return &m.stderrBuffer
}

func (m *mockSSHSession) Exit(code int) error {
	m.exitCode = code
	return nil
}

func (m *mockSSHSession) Command() []string {
	if m.cmd == "" {
		return []string{}
	}
	return strings.Fields(m.cmd) // This is what gliderlabs/ssh.Session.Command() returns according to its docs
}
func (m *mockSSHSession) RawCommand() string { return m.cmd }


func (m *mockSSHSession) PublicKey() gliderssh.PublicKey { return nil }
func (m *mockSSHSession) User() string                   { return "testuser" }
func (m *mockSSHSession) RemoteAddr() net.Addr           { return &net.TCPAddr{IP: net.ParseIP("127.0.0.1"), Port: 12345} }
func (m *mockSSHSession) LocalAddr() net.Addr            { return &net.TCPAddr{IP: net.ParseIP("127.0.0.1"), Port: 2222} }
func (m *mockSSHSession) Environ() []string {
	var result []string
	for k, v := range m.env {
		result = append(result, fmt.Sprintf("%s=%s", k, v))
	}
	return result
}
func (m *mockSSHSession) Pty() (gliderssh.Pty, <-chan gliderssh.Window, bool) { return m.pty, nil, false } // Simplified
func (m *mockSSHSession) Context() gliderssh.Context {
	// Need a concrete type that implements gliderssh.Context
	// For testing, often a struct holding necessary values is enough.
	// If gliderssh.Context has methods that are called, they need to be implemented.
	// Assuming a basic context for SessionID for now.
	return &mockSSHContext{sessionID: m.sessID, parentCtx: m.sessCtx}
}
func (m *mockSSHSession) Permissions() *gliderssh.Permissions { return m.permissions }


// mockSSHContext implements gliderssh.Context
type mockSSHContext struct {
	// ssh.Context // It's an interface, cannot embed directly
	// Instead, implement methods of ssh.Context as needed by the code under test.
	// For handleSession, s.Context().SessionID() is used.
	sessionID string
	parentCtx context.Context // for context.Context compatibility
}
func (m *mockSSHContext) SessionID() string                               { return m.sessionID }
func (m *mockSSHContext) User() string                                  { return "testuser" }
func (m *mockSSHContext) RemoteAddr() net.Addr                          { return &net.TCPAddr{IP: net.ParseIP("127.0.0.1"), Port: 12345} }
func (m *mockSSHContext) LocalAddr() net.Addr                           { return &net.TCPAddr{IP: net.ParseIP("127.0.0.1"), Port: 2222} }
func (m *mockSSHContext) ClientVersion() string                         { return "SSH-2.0-mockclient" }
func (m *mockSSHContext) ServerVersion() string                         { return "SSH-2.0-mockserver" }
func (m *mockSSHContext) Value(key interface{}) interface{}             { return m.parentCtx.Value(key) } // Pass through for other context values
func (m *mockSSHContext) SetValue(key, value interface{})               {}
func (m *mockSSHContext) Permissions() *gliderssh.Permissions           { return nil } // Simplified
func (m *mockSSHContext) Deadline() (deadline time.Time, ok bool)       { return time.Time{}, false }
func (m *mockSSHContext) Done() <-chan struct{}                         { return nil }
func (m *mockSSHContext) Err() error                                    { return nil }


// mockDockerManager implements parts of dockerManager for testing
type mockDockerManager struct {
	apiContainerList    []*container.ApiInfo
	getDockerStatsErr   error
	getContainerLogsErr error
	logsContent         string
	// For assertions
	getDockerStatsCalled   bool
	getContainerLogsCalled bool
	lastContainerID        string
	lastSince              string
	lastTail               string
	lastFollow             bool
}

func (m *mockDockerManager) getDockerStats() ([]*container.Stats, error) {
	m.getDockerStatsCalled = true
	// The actual []*container.Stats isn't used by handleGetDockerContainers, only apiContainerList matters.
	// So, we return nil for stats part if no error.
	return nil, m.getDockerStatsErr
}

func (m *mockDockerManager) getContainerLogs(containerID string, since string, tail string, follow bool) (io.ReadCloser, error) {
	m.getContainerLogsCalled = true
	m.lastContainerID = containerID
	m.lastSince = since
	m.lastTail = tail
	m.lastFollow = follow

	if m.getContainerLogsErr != nil {
		return nil, m.getContainerLogsErr
	}
	return io.NopCloser(strings.NewReader(m.logsContent)), nil
}


func TestStartServer(t *testing.T) {
	// Generate a test key pair
	pubKey, privKey, err := ed25519.GenerateKey(nil)
	require.NoError(t, err)
	signer, err := ssh.NewSignerFromKey(privKey)
	require.NoError(t, err)
	sshPubKey, err := ssh.NewPublicKey(pubKey)
	require.NoError(t, err)

	// Generate a different key pair for bad key test
	badPubKey, badPrivKey, err := ed25519.GenerateKey(nil)
	require.NoError(t, err)
	badSigner, err := ssh.NewSignerFromKey(badPrivKey)
	require.NoError(t, err)
	sshBadPubKey, err := ssh.NewPublicKey(badPubKey)
	require.NoError(t, err)

	socketFile := filepath.Join(t.TempDir(), "beszel-test.sock")

	tests := []struct {
		name        string
		config      ServerOptions
		wantErr     bool
		errContains string
		setup       func() error
		cleanup     func() error
	}{
		{
			name: "tcp port only",
			config: ServerOptions{
				Network: "tcp",
				Addr:    ":45987",
				Keys:    []ssh.PublicKey{sshPubKey},
			},
		},
		{
			name: "tcp with ipv4",
			config: ServerOptions{
				Network: "tcp4",
				Addr:    "127.0.0.1:45988",
				Keys:    []ssh.PublicKey{sshPubKey},
			},
		},
		{
			name: "tcp with ipv6",
			config: ServerOptions{
				Network: "tcp6",
				Addr:    "[::1]:45989",
				Keys:    []ssh.PublicKey{sshPubKey},
			},
		},
		{
			name: "unix socket",
			config: ServerOptions{
				Network: "unix",
				Addr:    socketFile,
				Keys:    []ssh.PublicKey{sshPubKey},
			},
			setup: func() error {
				// Create a socket file that should be removed
				f, err := os.Create(socketFile)
				if err != nil {
					return err
				}
				return f.Close()
			},
			cleanup: func() error {
				return os.Remove(socketFile)
			},
		},
		{
			name: "bad key should fail",
			config: ServerOptions{
				Network: "tcp",
				Addr:    ":45987",
				Keys:    []ssh.PublicKey{sshBadPubKey},
			},
			wantErr:     true,
			errContains: "ssh: handshake failed",
		},
		{
			name: "good key still good",
			config: ServerOptions{
				Network: "tcp",
				Addr:    ":45987",
				Keys:    []ssh.PublicKey{sshPubKey},
			},
		},
	}

	for _, tt := range tests {
		// Skip bad key test if it's not the one being focused on, to avoid port conflicts on retry
		if os.Getenv("FOCUS_TEST") != "" && tt.name != os.Getenv("FOCUS_TEST") && strings.Contains(tt.name, "bad key") {
			t.Skip("Skipping due to FOCUS_TEST on another test")
		}

		t.Run(tt.name, func(t *testing.T) {
			if tt.setup != nil {
				err := tt.setup()
				require.NoError(t, err)
			}

			if tt.cleanup != nil {
				defer tt.cleanup()
			}

			agent := NewAgent()

			// Start server in a goroutine since it blocks
			errChan := make(chan error, 1)
			go func() {
				errChan <- agent.StartServer(tt.config)
			}()

			// Add a short delay to allow the server to start
			time.Sleep(100 * time.Millisecond)

			// Try to connect to verify server is running
			var client *ssh.Client
			var err error

			// Choose the appropriate signer based on the test case
			testSigner := signer
			if tt.name == "bad key should fail" {
				testSigner = badSigner
			}

			sshClientConfig := &ssh.ClientConfig{
				User: "a",
				Auth: []ssh.AuthMethod{
					ssh.PublicKeys(testSigner),
				},
				HostKeyCallback: ssh.InsecureIgnoreHostKey(),
				Timeout:         4 * time.Second,
			}

			switch tt.config.Network {
			case "unix":
				client, err = ssh.Dial("unix", tt.config.Addr, sshClientConfig)
			default:
				if !strings.Contains(tt.config.Addr, ":") {
					tt.config.Addr = ":" + tt.config.Addr
				}
				client, err = ssh.Dial("tcp", tt.config.Addr, sshClientConfig)
			}

			if tt.wantErr {
				assert.Error(t, err)
				if tt.errContains != "" {
					assert.Contains(t, err.Error(), tt.errContains)
				}
				return
			}

			require.NoError(t, err)
			require.NotNil(t, client)
			client.Close()

			// Ensure server goroutine finishes
			select {
			case err := <-errChan:
				// if we expected an error from Dial, the server might still be running OK
				// if we expected no error from Dial, then server should not error here
				if !tt.wantErr && err != nil && !strings.Contains(err.Error(), "use of closed network connection") { // server.Serve returns this on graceful shutdown
					t.Errorf("server failed unexpectedly: %v", err)
				}
			case <-time.After(200 * time.Millisecond): // timeout waiting for server to stop if it should have
				// This is tricky because a successful server will block indefinitely.
				// We only expect errChan to yield an error if StartServer itself fails immediately.
			}

		})
	}
}


func TestHandleGetDockerContainers(t *testing.T) {
	agent := NewAgent() // Real agent, but with mocked dockerManager
	mockDM := &mockDockerManager{}
	agent.dockerManager = mockDM

	mockSess := &mockSSHSession{sessID: "test-session-containers"}

	// Scenario 1: Successful retrieval
	mockDM.apiContainerList = []*container.ApiInfo{
		{Id: "id1", Names: []string{"/container1"}, Image: "image1", Status: "Up 2 hours", IdShort: "id1short"},
		{Id: "id2", Names: []string{"/container2"}, Image: "image2", Status: "Exited (0) 1 day ago", IdShort: "id2short"},
	}
	mockDM.getDockerStatsErr = nil
	mockDM.getDockerStatsCalled = false // Reset for assertion

	agent.handleGetDockerContainers(mockSess)

	assert.True(t, mockDM.getDockerStatsCalled, "expected getDockerStats to be called")
	assert.Equal(t, 0, mockSess.exitCode, "expected exit code 0 for success")

	var returnedContainers []*container.ApiInfo
	err := json.Unmarshal(mockSess.stdoutBuffer.Bytes(), &returnedContainers)
	require.NoError(t, err, "failed to unmarshal stdout to JSON")
	assert.Equal(t, mockDM.apiContainerList, returnedContainers, "JSON output mismatch")
	mockSess.stdoutBuffer.Reset() // Clear for next test case

	// Scenario 2: getDockerStats returns an error
	mockDM.apiContainerList = nil
	mockDM.getDockerStatsErr = fmt.Errorf("docker stats error")
	mockDM.getDockerStatsCalled = false

	agent.handleGetDockerContainers(mockSess)
	assert.True(t, mockDM.getDockerStatsCalled, "expected getDockerStats to be called on error path")
	assert.Equal(t, 1, mockSess.exitCode, "expected exit code 1 for getDockerStats error")
	assert.Contains(t, mockSess.stderrBuffer.String(), "Error getting Docker stats: docker stats error")
	mockSess.stderrBuffer.Reset()
	mockSess.stdoutBuffer.Reset()


	// Scenario 3: dockerManager is nil (agent not fully initialized)
	agent.dockerManager = nil
	agent.handleGetDockerContainers(mockSess)
	assert.Equal(t, 1, mockSess.exitCode, "expected exit code 1 if dockerManager is nil")
	assert.Contains(t, mockSess.stderrBuffer.String(), "Docker manager not initialized")
	mockSess.stderrBuffer.Reset()

	// Restore dockerManager for other tests if agent is reused (it's not here, but good practice)
	agent.dockerManager = mockDM
}

func TestHandleGetDockerLogs(t *testing.T) {
	agent := NewAgent()
	mockDM := &mockDockerManager{}
	agent.dockerManager = mockDM

	baseArgs := []string{"agent_cli", "get-docker-logs"} // Will be further processed by handleSession

	tests := []struct {
		name              string
		cmdArgs           []string // Args as they would be *after* "agent_cli get-docker-logs" is stripped
		logsContent       string
		getLogsErr        error
		expectedExitCode  int
		expectedStdout    string
		expectedStderr    string
		expectedContainerID string
		expectedSince     string
		expectedTail      string
		expectedFollow    bool
		dmShouldBeNil     bool
	}{
		{
			name:              "Success basic",
			cmdArgs:           []string{"--id", "testcontainer1"},
			logsContent:       "Log line 1\nLog line 2",
			expectedExitCode:  0,
			expectedStdout:    "Log line 1\nLog line 2",
			expectedContainerID: "testcontainer1",
		},
		{
			name:              "Success with all params",
			cmdArgs:           []string{"--id", "c2", "--since", "1h", "--tail", "50", "--follow"},
			logsContent:       "Followed log",
			expectedExitCode:  0,
			expectedStdout:    "Followed log",
			expectedContainerID: "c2",
			expectedSince:     "1h",
			expectedTail:      "50",
			expectedFollow:    true,
		},
		{
			name:             "DockerManager GetContainerLogs returns error",
			cmdArgs:          []string{"--id", "c3"},
			getLogsErr:       fmt.Errorf("failed to get logs"),
			expectedExitCode: 1,
			expectedStderr:   "Error getting container logs for c3: failed to get logs",
			expectedContainerID: "c3",
		},
		{
			name:             "Missing --id",
			cmdArgs:          []string{"--since", "10m"},
			expectedExitCode: 1,
			expectedStderr:   "Container ID (--id) is required",
		},
		{
			name:             "Docker manager is nil",
			cmdArgs:          []string{"--id", "c4"},
			dmShouldBeNil:    true,
			expectedExitCode: 1,
			expectedStderr:   "Docker manager not initialized",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockSess := &mockSSHSession{sessID: "test-session-logs-" + tt.name}
			// The handleSession function does the first split. Here we simulate passing the remaining args.
			// mockSess.cmd = strings.Join(append(baseArgs, tt.cmdArgs...), " ") // This is not used by handleGetDockerLogs directly

			if tt.dmShouldBeNil {
				agent.dockerManager = nil
			} else {
				agent.dockerManager = mockDM
				mockDM.logsContent = tt.logsContent
				mockDM.getContainerLogsErr = tt.getLogsErr
				mockDM.getContainerLogsCalled = false // Reset for assertion
			}

			agent.handleGetDockerLogs(mockSess, tt.cmdArgs)

			assert.Equal(t, tt.expectedExitCode, mockSess.exitCode, "exit code mismatch")

			if tt.expectedStdout != "" {
				assert.Equal(t, tt.expectedStdout, mockSess.stdoutBuffer.String(), "stdout mismatch")
			}
			if tt.expectedStderr != "" {
				assert.Contains(t, mockSess.stderrBuffer.String(), tt.expectedStderr, "stderr mismatch")
			}

			if !tt.dmShouldBeNil && tt.expectedContainerID != "" { // Only assert if DM was expected to be called
				assert.True(t, mockDM.getContainerLogsCalled, "expected getContainerLogs to be called")
				assert.Equal(t, tt.expectedContainerID, mockDM.lastContainerID, "containerID passed to getContainerLogs mismatch")
				assert.Equal(t, tt.expectedSince, mockDM.lastSince, "since passed to getContainerLogs mismatch")
				assert.Equal(t, tt.expectedTail, mockDM.lastTail, "tail passed to getContainerLogs mismatch")
				assert.Equal(t, tt.expectedFollow, mockDM.lastFollow, "follow passed to getContainerLogs mismatch")
			}
		})
	}
	// Restore DM for other potential tests
	agent.dockerManager = mockDM
}


/////////////////////////////////////////////////////////////////
//////////////////// ParseKeys Tests ////////////////////////////
/////////////////////////////////////////////////////////////////

// Helper function to generate a temporary file with content
func createTempFile(content string) (string, error) {
	tmpFile, err := os.CreateTemp("", "ssh_keys_*.txt")
	if err != nil {
		return "", fmt.Errorf("failed to create temp file: %w", err)
	}
	defer tmpFile.Close()

	if _, err := tmpFile.WriteString(content); err != nil {
		return "", fmt.Errorf("failed to write to temp file: %w", err)
	}

	return tmpFile.Name(), nil
}

// Test case 1: String with a single SSH key
func TestParseSingleKeyFromString(t *testing.T) {
	input := "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKCBM91kukN7hbvFKtbpEeo2JXjCcNxXcdBH7V7ADMBo"
	keys, err := ParseKeys(input)
	if err != nil {
		t.Fatalf("Expected no error, got: %v", err)
	}
	if len(keys) != 1 {
		t.Fatalf("Expected 1 key, got %d keys", len(keys))
	}
	if keys[0].Type() != "ssh-ed25519" {
		t.Fatalf("Expected key type 'ssh-ed25519', got '%s'", keys[0].Type())
	}
}

// Test case 2: String with multiple SSH keys
func TestParseMultipleKeysFromString(t *testing.T) {
	input := "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKCBM91kukN7hbvFKtbpEeo2JXjCcNxXcdBH7V7ADMBo\nssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJDMtAOQfxDlCxe+A5lVbUY/DHxK1LAF2Z3AV0FYv36D \n #comment\n ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJDMtAOQfxDlCxe+A5lVbUY/DHxK1LAF2Z3AV0FYv36D"
	keys, err := ParseKeys(input)
	if err != nil {
		t.Fatalf("Expected no error, got: %v", err)
	}
	if len(keys) != 3 {
		t.Fatalf("Expected 3 keys, got %d keys", len(keys))
	}
	if keys[0].Type() != "ssh-ed25519" || keys[1].Type() != "ssh-ed25519" || keys[2].Type() != "ssh-ed25519" {
		t.Fatalf("Unexpected key types: %s, %s, %s", keys[0].Type(), keys[1].Type(), keys[2].Type())
	}
}

// Test case 3: File with a single SSH key
func TestParseSingleKeyFromFile(t *testing.T) {
	content := "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKCBM91kukN7hbvFKtbpEeo2JXjCcNxXcdBH7V7ADMBo"
	filePath, err := createTempFile(content)
	if err != nil {
		t.Fatalf("Failed to create temp file: %v", err)
	}
	defer os.Remove(filePath) // Clean up the file after the test

	// Read the file content
	fileContent, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatalf("Failed to read temp file: %v", err)
	}

	// Parse the keys
	keys, err := ParseKeys(string(fileContent))
	if err != nil {
		t.Fatalf("Expected no error, got: %v", err)
	}
	if len(keys) != 1 {
		t.Fatalf("Expected 1 key, got %d keys", len(keys))
	}
	if keys[0].Type() != "ssh-ed25519" {
		t.Fatalf("Expected key type 'ssh-ed25519', got '%s'", keys[0].Type())
	}
}

// Test case 4: File with multiple SSH keys
func TestParseMultipleKeysFromFile(t *testing.T) {
	content := "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKCBM91kukN7hbvFKtbpEeo2JXjCcNxXcdBH7V7ADMBo\nssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJDMtAOQfxDlCxe+A5lVbUY/DHxK1LAF2Z3AV0FYv36D \n #comment\n ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJDMtAOQfxDlCxe+A5lVbUY/DHxK1LAF2Z3AV0FYv36D"
	filePath, err := createTempFile(content)
	if err != nil {
		t.Fatalf("Failed to create temp file: %v", err)
	}
	// defer os.Remove(filePath) // Clean up the file after the test

	// Read the file content
	fileContent, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatalf("Failed to read temp file: %v", err)
	}

	// Parse the keys
	keys, err := ParseKeys(string(fileContent))
	if err != nil {
		t.Fatalf("Expected no error, got: %v", err)
	}
	if len(keys) != 3 {
		t.Fatalf("Expected 3 keys, got %d keys", len(keys))
	}
	if keys[0].Type() != "ssh-ed25519" || keys[1].Type() != "ssh-ed25519" || keys[2].Type() != "ssh-ed25519" {
		t.Fatalf("Unexpected key types: %s, %s, %s", keys[0].Type(), keys[1].Type(), keys[2].Type())
	}
}

// Test case 5: Invalid SSH key input
func TestParseInvalidKey(t *testing.T) {
	input := "invalid-key-data"
	_, err := ParseKeys(input)
	if err == nil {
		t.Fatalf("Expected an error for invalid key, got nil")
	}
	expectedErrMsg := "failed to parse key"
	if !strings.Contains(err.Error(), expectedErrMsg) {
		t.Fatalf("Expected error message to contain '%s', got: %v", expectedErrMsg, err)
	}
}
