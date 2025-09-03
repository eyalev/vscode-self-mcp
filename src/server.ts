#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { VSCodeController } from './vscode-controller.js';

class VSCodeMCPServer {
  private server: Server;
  private vscode: VSCodeController;

  constructor() {
    this.server = new Server(
      {
        name: 'vscode-self-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );

    this.vscode = new VSCodeController();
    this.setupHandlers();
  }

  private setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'open_file',
          description: 'Open a file in VSCode',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Path to the file to open',
              },
              line: {
                type: 'number',
                description: 'Optional line number to jump to',
              },
            },
            required: ['path'],
          },
        },
        {
          name: 'run_terminal_command',
          description: 'Execute a command in VSCode terminal',
          inputSchema: {
            type: 'object',
            properties: {
              command: {
                type: 'string',
                description: 'Command to execute',
              },
              cwd: {
                type: 'string',
                description: 'Working directory (optional)',
              },
            },
            required: ['command'],
          },
        },
        {
          name: 'create_file',
          description: 'Create a new file with content',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Path for the new file',
              },
              content: {
                type: 'string',
                description: 'File content',
              },
            },
            required: ['path', 'content'],
          },
        },
        {
          name: 'search_workspace',
          description: 'Search for files or content in workspace',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search query',
              },
              type: {
                type: 'string',
                enum: ['files', 'content'],
                description: 'Search type: files or content',
              },
            },
            required: ['query', 'type'],
          },
        },
        {
          name: 'reveal_in_explorer',
          description: 'Reveal a file in VSCode file explorer',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Path to the file to reveal',
              },
            },
            required: ['path'],
          },
        },
        {
          name: 'focus_explorer',
          description: 'Focus the VSCode file explorer view',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'select_file_in_explorer',
          description: 'Select/highlight a file in VSCode file explorer',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Path to the file to select',
              },
            },
            required: ['path'],
          },
        },
      ],
    }));

    // List available resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        {
          uri: 'vscode://workspace/files',
          name: 'Workspace Files',
          description: 'List of files in the current workspace',
          mimeType: 'application/json',
        },
        {
          uri: 'vscode://editor/content',
          name: 'Current Editor Content',
          description: 'Content of the currently active editor',
          mimeType: 'text/plain',
        },
      ],
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      if (!args) {
        throw new Error('Missing arguments');
      }

      switch (name) {
        case 'open_file':
          return await this.vscode.openFile(args.path as string, args.line as number);

        case 'run_terminal_command':
          return await this.vscode.runTerminalCommand(args.command as string, args.cwd as string);

        case 'create_file':
          return await this.vscode.createFile(args.path as string, args.content as string);

        case 'search_workspace':
          return await this.vscode.searchWorkspace(args.query as string, args.type as 'files' | 'content');

        case 'reveal_in_explorer':
          return await this.vscode.revealInExplorer(args.path as string);

        case 'focus_explorer':
          return await this.vscode.focusExplorer();

        case 'select_file_in_explorer':
          return await this.vscode.selectFileInExplorer(args.path as string);

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });

    // Handle resource reads
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;

      switch (uri) {
        case 'vscode://workspace/files':
          return await this.vscode.getWorkspaceFiles();

        case 'vscode://editor/content':
          return await this.vscode.getCurrentEditorContent();

        default:
          throw new Error(`Unknown resource: ${uri}`);
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}

// Start server if run directly
if (require.main === module) {
  const server = new VSCodeMCPServer();
  server.run().catch((error) => {
    console.error('Server error:', error);
    process.exit(1);
  });
}

export { VSCodeMCPServer };