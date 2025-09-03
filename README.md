# VSCode Helper

A command-line helper tool for controlling VSCode from the terminal and AI agents. This project provides both a standalone CLI interface and an MCP server for AI agent integration, enabling workspace management, file operations, and VSCode control.

## Features

- **Smart Workspace Detection**: Automatically detects active VSCode workspaces using VSCode's own status API
- **CLI Interface**: Comprehensive command-line tool for VSCode control
- **JSON Output Support**: Structured output for scripting and automation
- **File Operations**: Open, create, and manage files in VSCode
- **Workspace Management**: List, detect, and work with open VSCode workspaces
- **Terminal Integration**: Execute commands in VSCode terminal
- **Search Capabilities**: Search files and content across workspace
- **MCP Server**: Full MCP server implementation for AI agent integration

## Installation

### From Source
```bash
npm install
npm run build
npm install -g .
```

### Global Installation
```bash
npm install -g vscode-helper
```

## Usage

### CLI Commands

#### Workspace Management
```bash
# Show current active VSCode workspace
vscode-helper workspace

# List all open VSCode workspaces
vscode-helper workspaces

# Get workspace info as JSON
vscode-helper workspace --json
vscode-helper workspaces --json
```

#### File Operations
```bash
# Open a file in VSCode
vscode-helper open src/server.ts

# Open file at specific line
vscode-helper open src/server.ts --line 42

# Create a new file
vscode-helper create newfile.txt --content "Hello World"

# Select/highlight file in VSCode file explorer
vscode-helper select package.json

# Reveal file in VSCode file explorer
vscode-helper reveal src/server.ts
```

#### Workspace Search
```bash
# Search for files
vscode-helper search package --type files

# Search file content
vscode-helper search "VSCode" --type content

# Get search results as JSON
vscode-helper search "error" --type content --json

# List workspace files
vscode-helper files
vscode-helper files --json
```

#### Terminal & Navigation
```bash
# Run a terminal command
vscode-helper run "npm install"

# Focus VSCode file explorer
vscode-helper focus-explorer
```

#### MCP Server
```bash
# Start MCP server for AI agent integration
vscode-helper server
```

### Key Features

#### Smart Workspace Detection
The tool intelligently detects your active VSCode workspace by:
1. Using VSCode's built-in `code --status` API to get currently open workspaces
2. Prioritizing workspaces that contain your current working directory
3. Falling back to workspace indicators (.git, package.json, etc.)
4. Using VSCode's recent workspace storage as final fallback

#### Context-Aware File Operations
When you run `vscode-helper select package.json` from any terminal location, it will find and select the `package.json` file in your currently active VSCode workspace, not the terminal's current directory.

#### JSON Output Support
Most commands support `--json` flag for structured output:
- `--json` flag provides machine-readable output for scripting
- Regular output provides human-friendly formatting
- Perfect for integration with other tools and scripts

## MCP Server Integration

To integrate with AI agents like Claude Code, add this server to your MCP configuration:

```json
{
  "mcpServers": {
    "vscode-helper": {
      "command": "vscode-helper",
      "args": ["server"]
    }
  }
}
```

### MCP Tools Available:
- `open_file`: Open files in VSCode
- `run_terminal_command`: Execute terminal commands
- `create_file`: Create new files
- `search_workspace`: Search files or content
- `reveal_in_explorer`: Reveal files in VSCode file explorer
- `focus_explorer`: Focus the VSCode file explorer view
- `select_file_in_explorer`: Select/highlight files in VSCode file explorer

### MCP Resources Available:
- `vscode://workspace/files`: List workspace files
- `vscode://editor/content`: Current editor content (requires extension)

## Architecture

The project consists of:

- **VSCode Controller** (`src/vscode-controller.ts`): Core VSCode integration and workspace detection logic
- **CLI Interface** (`src/cli.ts`): Command-line wrapper with argument parsing
- **MCP Server** (`src/server.ts`): Handles MCP protocol communication for AI agents

## Requirements

- Node.js 18+
- VSCode installed and accessible via `code` command
- Linux/Ubuntu (primary target platform)
- TypeScript for development

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Install locally for testing
npm install -g .

# Run in development
npm run dev

# Test CLI directly
npm run cli -- workspaces
```

## Examples

### Working with Multiple VSCode Windows
```bash
# List all open VSCode workspaces
$ vscode-helper workspaces
Open VSCode workspaces (3):
  project-a - /home/user/projects/project-a
  project-b - /home/user/projects/project-b
  project-c - /home/user/projects/project-c

# Get the active workspace (based on current context)
$ vscode-helper workspace
Active VSCode workspace: /home/user/projects/project-a

# Select a file in the active workspace from anywhere
$ cd /tmp
$ vscode-helper select src/main.py
Successfully selected src/main.py in VSCode file explorer (workspace: /home/user/projects/project-a)
```

### JSON Integration
```bash
# Get workspace data for scripting
$ vscode-helper workspaces --json | jq '.[].name'
"project-a"
"project-b" 
"project-c"

# Search and process results
$ vscode-helper search "TODO" --type content --json | jq '.results'
```

## Limitations

- Primarily designed for Linux/Ubuntu environments
- Some features require VSCode to be running
- Terminal integration may vary by desktop environment
- MCP server mode is designed for local usage only

## Contributing

This project focuses on local VSCode automation and AI agent integration. Feel free to fork and adapt for your specific needs.