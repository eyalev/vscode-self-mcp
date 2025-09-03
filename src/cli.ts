#!/usr/bin/env node

import { Command } from 'commander';
import { VSCodeController } from './vscode-controller.js';

const program = new Command();

// Enable debug mode via environment variable or --debug flag
const isDebug = process.env.VSCODE_MCP_DEBUG === 'true' || process.argv.includes('--debug');
const vscode = new VSCodeController(isDebug);

program
  .name('vscode-helper')
  .description('CLI helper for controlling VSCode from command line')
  .version('1.0.0')
  .option('--debug', 'Enable debug output');

program
  .command('open')
  .description('Open a file in VSCode')
  .argument('<file>', 'File path to open')
  .option('-l, --line <number>', 'Line number to jump to', parseInt)
  .action(async (file, options) => {
    try {
      const result = await vscode.openFile(file, options.line);
      console.log(result.content[0].text);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

program
  .command('create')
  .description('Create a new file')
  .argument('<file>', 'File path to create')
  .option('-c, --content <content>', 'File content', '')
  .action(async (file, options) => {
    try {
      const result = await vscode.createFile(file, options.content);
      console.log(result.content[0].text);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

program
  .command('run')
  .description('Run a command in terminal')
  .argument('<command>', 'Command to execute')
  .option('--cwd <dir>', 'Working directory')
  .action(async (command, options) => {
    try {
      const result = await vscode.runTerminalCommand(command, options.cwd);
      console.log(result.content[0].text);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

program
  .command('search')
  .description('Search workspace')
  .argument('<query>', 'Search query')
  .option('-t, --type <type>', 'Search type: files or content', 'files')
  .option('--json', 'Output as JSON')
  .action(async (query, options) => {
    try {
      if (!['files', 'content'].includes(options.type)) {
        throw new Error('Type must be "files" or "content"');
      }
      const result = await vscode.searchWorkspace(query, options.type as 'files' | 'content');
      
      if (options.json) {
        const output = {
          query,
          type: options.type,
          results: result.content[0].text
        };
        console.log(JSON.stringify(output, null, 2));
      } else {
        console.log(result.content[0].text);
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

program
  .command('files')
  .description('List workspace files')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const result = await vscode.getWorkspaceFiles();
      if (options.json) {
        console.log(result.contents[0].text); // Already JSON formatted
      } else {
        const files = JSON.parse(result.contents[0].text);
        console.log(`Workspace files (${files.length}):\n${files.map((f: any) => `  ${f.path}`).join('\n')}`);
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

program
  .command('reveal')
  .description('Reveal a file in VSCode file explorer')
  .argument('<file>', 'File path to reveal')
  .action(async (file) => {
    try {
      const result = await vscode.revealInExplorer(file);
      console.log(result.content[0].text);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

program
  .command('select')
  .description('Select a file in VSCode file explorer')
  .argument('<file>', 'File path to select')
  .action(async (file) => {
    try {
      const result = await vscode.selectFileInExplorer(file);
      console.log(result.content[0].text);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

program
  .command('focus-explorer')
  .description('Focus VSCode file explorer')
  .action(async () => {
    try {
      const result = await vscode.focusExplorer();
      console.log(result.content[0].text);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

program
  .command('workspace')
  .description('Workspace management commands')
  .argument('[action]', 'Action to perform (open-terminal, focus, open-file)')
  .option('--active', 'Show the current active workspace')
  .option('--list', 'List all open workspaces')
  .option('--get <name>', 'Target specific workspace by name')
  .option('--json', 'Output as JSON')
  .action(async (action, options) => {
    try {
      // Handle workspace information queries first
      if (options.active) {
        const result = await vscode.getActiveWorkspace();
        if (options.json) {
          const activeWorkspace = await vscode.getActiveVSCodeWorkspacePath();
          console.log(JSON.stringify({ activeWorkspace }, null, 2));
        } else {
          console.log(result.content[0].text);
        }
        return;
      }
      
      if (options.list) {
        const result = await vscode.getAllWorkspaces();
        if (options.json) {
          console.log(JSON.stringify(result.workspaces, null, 2));
        } else {
          console.log(result.content[0].text);
        }
        return;
      }

      // Handle --get without action (show workspace info)
      if (options.get && !action) {
        const result = await vscode.getWorkspaceInfo(options.get);
        if (options.json) {
          console.log(JSON.stringify(result.workspace, null, 2));
        } else {
          console.log(result.content[0].text);
        }
        return;
      }

      // Handle workspace actions that require an action argument
      if (!action) {
        throw new Error('Please specify an action (open-terminal, focus, open-file) or use --active/--list flags');
      }

      switch (action) {
        case 'open-terminal':
          const terminalResult = await vscode.openTerminalInWorkspace(options.get);
          console.log(terminalResult.content[0].text);
          break;

        case 'focus':
          const focusResult = await vscode.focusWorkspace(options.get);
          console.log(focusResult.content[0].text);
          break;
        
        case 'open-file':
          // TODO: Implement workspace file opening
          console.log('Open-file functionality not yet implemented');
          break;
        
        default:
          throw new Error(`Unknown action: ${action}. Available actions: open-terminal, focus, open-file`);
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

program
  .command('server')
  .description('Start MCP server for AI agent integration')
  .action(async () => {
    try {
      const { VSCodeMCPServer } = await import('./server.js');
      const server = new VSCodeMCPServer();
      console.log('Starting VSCode MCP server...');
      await server.run();
    } catch (error) {
      console.error('Server error:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

// Parse command line arguments
program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}