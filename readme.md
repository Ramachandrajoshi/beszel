# Beszel

Beszel is a lightweight server monitoring platform that includes Docker statistics, historical data, and alert functions.

It has a friendly web interface, simple configuration, and is ready to use out of the box. It supports automatic backup, multi-user, OAuth authentication, and API access.

[![agent Docker Image Size](https://img.shields.io/docker/image-size/henrygd/beszel-agent/latest?logo=docker&label=agent%20image%20size)](https://hub.docker.com/r/henrygd/beszel-agent)
[![hub Docker Image Size](https://img.shields.io/docker/image-size/henrygd/beszel/latest?logo=docker&label=hub%20image%20size)](https://hub.docker.com/r/henrygd/beszel)
[![MIT license](https://img.shields.io/github/license/henrygd/beszel?color=%239944ee)](https://github.com/henrygd/beszel/blob/main/LICENSE)
[![Crowdin](https://badges.crowdin.net/beszel/localized.svg)](https://crowdin.com/project/beszel)

![Screenshot of Beszel dashboard and system page, side by side. The dashboard shows metrics from multiple connected systems, while the system page shows detailed metrics for a single system.](https://henrygd-assets.b-cdn.net/beszel/screenshot-new.png)

## Features

- **Lightweight**: Smaller and less resource-intensive than leading solutions.
- **Simple**: Easy setup with little manual configuration required.
- **Docker stats**: Tracks CPU, memory, and network usage history for each container.
- **Alerts**: Configurable alerts for CPU, memory, disk, bandwidth, temperature, and status.
- **Multi-user**: Users manage their own systems. Admins can share systems across users.
- **OAuth / OIDC**: Supports many OAuth2 providers. Password auth can be disabled.
- **Automatic backups**: Save to and restore from disk or S3-compatible storage.
<!-- - **REST API**: Use or update your data in your own scripts and applications. -->

## Architecture

Beszel consists of two main components: the **hub** and the **agent**.

- **Hub**: A web application built on [PocketBase](https://pocketbase.io/) that provides a dashboard for viewing and managing connected systems.
- **Agent**: Runs on each system you want to monitor, creating a minimal SSH server to communicate system metrics to the hub.

## Building Beszel

To build Beszel from source, you'll need to have Go (version 1.20 or later recommended) installed on your system. The frontend assets for the Hub are typically built using Bun or npm, which will also be needed if you're not skipping the web UI build.

You can build the components using the provided Makefile or standard `go build` commands.

### Using Make

The simplest way to build is using the `Makefile` located in the `beszel` directory:

*   **Build both Hub and Agent:**
    ```bash
    make build
    ```
*   **Build only the Hub:**
    ```bash
    make build-hub
    ```
*   **Build only the Agent:**
    ```bash
    make build-agent
    ```
The compiled binaries will be placed in the `./build` directory within the `beszel` directory (e.g., `beszel/build/beszel_linux_amd64` and `beszel/build/beszel-agent_linux_amd64`).

You can also specify the target operating system and architecture:
```bash
# Example for Windows amd64
make OS=windows ARCH=amd64 build
```

### Using `go build`

Alternatively, you can use standard `go build` commands from the root of the repository:

*   **Build the Hub:**
    ```bash
    go build -o ./beszel/build/beszel_$(go env GOOS)_$(go env GOARCH) -ldflags "-w -s" ./beszel/cmd/hub
    ```
    *Note: This command skips building the web UI. For a complete Hub build including the UI, it's recommended to use `make build-hub` or ensure the UI is built separately first (see `make build-web-ui` target).*

*   **Build the Agent:**
    ```bash
    go build -o ./beszel/build/beszel-agent_$(go env GOOS)_$(go env GOARCH) -ldflags "-w -s" ./beszel/cmd/agent
    ```
Replace `$(go env GOOS)` and `$(go env GOARCH)` with your target OS and architecture if cross-compiling, or let Go determine them automatically. The output directory `./beszel/build/` needs to exist or be created first.

### Running/Installing the Binaries

Once you have built the Hub and Agent, you will find the binaries in the `./beszel/build/` directory (e.g., `beszel-hub_linux_amd64` and `beszel-agent_linux_amd64`).

*   **Running Directly:**
    You can run them directly from this location:
    ```bash
    # Example for the Hub
    ./beszel/build/beszel_linux_amd64 serve
    # Example for the Agent
    ./beszel/build/beszel-agent_linux_amd64
    ```
    Remember to use the correct binary name for your OS and architecture. The Hub typically requires the `serve` command to start.

*   **Installing (System-Wide Access):**
    For easier access, you can move the binaries to a directory included in your system's `PATH`, such as `/usr/local/bin`:
    ```bash
    # Example for Linux/macOS
    sudo mv ./beszel/build/beszel_linux_amd64 /usr/local/bin/beszel
    sudo mv ./beszel/build/beszel-agent_linux_amd64 /usr/local/bin/beszel-agent
    ```
    After this, you can run them simply as `beszel serve` and `beszel-agent`.

*   **Important Notes:**
    *   **Hub Data:** The Beszel Hub stores its data (including SQLite database, settings, etc.) in a `pb_data` directory. When you run `beszel serve`, it will create this directory in the current working directory unless specified otherwise via command-line flags (refer to `beszel serve --help`).
    *   **Agent Operation:** The Beszel Agent needs to run continuously to monitor a system. For production use, you'll typically want to run it as a system service (e.g., using systemd on Linux). Detailed instructions for setting up agents are available in the [official documentation](https://beszel.dev/guide/getting-started). The agent may also require appropriate permissions to access system metrics and Docker information.
    *   **Configuration:** Both Hub and Agent can be configured using environment variables or command-line flags. Consult the documentation or use the `--help` flag for more details (e.g., `beszel serve --help`, `beszel-agent --help`).

## Getting started

The [quick start guide](https://beszel.dev/guide/getting-started) and other documentation is available on our website, [beszel.dev](https://beszel.dev). You'll be up and running in a few minutes.

## Screenshots

![Dashboard](https://beszel.dev/image/dashboard.png)
![System page](https://beszel.dev/image/system-full.png)
![Notification Settings](https://beszel.dev/image/settings-notifications.png)

## Supported metrics

- **CPU usage** - Host system and Docker / Podman containers.
- **Memory usage** - Host system and containers. Includes swap and ZFS ARC.
- **Disk usage** - Host system. Supports multiple partitions and devices.
- **Disk I/O** - Host system. Supports multiple partitions and devices.
- **Network usage** - Host system and containers.
- **Temperature** - Host system sensors.
- **GPU usage / temperature / power draw** - Nvidia and AMD only. Must use binary agent.

## Help and discussion

Please search existing issues and discussions before opening a new one. I try my best to respond, but may not always have time to do so.

#### Bug reports and feature requests

Bug reports and detailed feature requests should be posted on [GitHub issues](https://github.com/henrygd/beszel/issues).

#### Support and general discussion

Support requests and general discussion can be posted on [GitHub discussions](https://github.com/henrygd/beszel/discussions) or the community-run [Matrix room](https://matrix.to/#/#beszel:matrix.org): `#beszel:matrix.org`.

## License

Beszel is licensed under the MIT License. See the [LICENSE](LICENSE) file for more details.
