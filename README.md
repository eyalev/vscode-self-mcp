# VSCode Self-MCP

A Model Context Protocol (MCP) server for controlling VSCode from AI agents. This project allows AI agents to interact with VSCode through MCP, enabling file operations, terminal commands, and workspace management.

## Features

- **MCP Server**: Full MCP server implementation for AI agent integration
- **CLI Interface**: Standalone CLI for direct VSCode control
- **File Operations**: Open, create, and manage files in VSCode
- **Terminal Integration**: Execute commands in VSCode terminal
- **Workspace Search**: Search files and content across workspace
- **Local Focus**: Optimized for local Ubuntu/Linux environments

## Installation

```bash
npm install
npm run build
```

## Usage

### CLI Mode

```bash
# Open a file in VSCode
npm run cli -- open src/server.ts

# Open file at specific line
npm run cli -- open src/server.ts --line 42

# Create a new file
npm run cli -- create newfile.txt --content "Hello World"

# Run a terminal command
npm run cli -- run "npm install"

# Search for files
npm run cli -- search package --type files

# Search file content
npm run cli -- search "VSCode" --type content

# List workspace files
npm run cli -- files

# Reveal file in VSCode file explorer
npm run cli -- reveal src/server.ts

# Select/highlight file in VSCode file explorer
npm run cli -- select package.json

# Focus VSCode file explorer
npm run cli -- focus-explorer
```

### MCP Server Mode

Start the MCP server:

```bash
npm run cli -- server
# or
npm start
```

The server communicates via stdio and supports these MCP tools:

- `open_file`: Open files in VSCode
- `run_terminal_command`: Execute terminal commands
- `create_file`: Create new files
- `search_workspace`: Search files or content
- `reveal_in_explorer`: Reveal files in VSCode file explorer
- `focus_explorer`: Focus the VSCode file explorer view
- `select_file_in_explorer`: Select/highlight files in VSCode file explorer

And these MCP resources:

- `vscode://workspace/files`: List workspace files
- `vscode://editor/content`: Current editor content (requires extension)

## MCP Integration

To integrate with AI agents like Claude Code, add this server to your MCP configuration:

```json
{
  "mcpServers": {
    "vscode-self-mcp": {
      "command": "node",
      "args": ["/path/to/vscode-self-mcp/dist/server.js"]
    }
  }
}
```

## Architecture

The project consists of:

- **MCP Server** (`src/server.ts`): Handles MCP protocol communication
- **VSCode Controller** (`src/vscode-controller.ts`): Core VSCode integration logic
- **CLI Interface** (`src/cli.ts`): Command-line wrapper for direct usage

## Requirements

- Node.js 18+
- VSCode installed and accessible via `code` command
- Ubuntu/Linux (primary target platform)
- TypeScript for development

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run in development
npm run dev

# Test basic functionality
node dist/simple-test.js
```

## Limitations

- Currently focused on Ubuntu/Linux
- Some features (like current editor content) require VSCode extension
- No authentication (local-only by design)
- Terminal integration varies by desktop environment

## Contributing

This is a personal project focused on local VSCode automation for AI agents. Feel free to fork and adapt for your needs.