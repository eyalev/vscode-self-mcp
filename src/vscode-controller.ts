import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { readFile, writeFile, access, mkdir } from 'fs/promises';
import { dirname, resolve, join } from 'path';
import { glob } from 'fast-glob';

const execAsync = promisify(exec);

export class VSCodeController {
  private workspaceRoot: string;
  private debug: boolean;

  constructor(debug: boolean = false) {
    this.workspaceRoot = process.cwd();
    this.debug = debug || process.env.VSCODE_MCP_DEBUG === 'true';
  }

  private log(message: string, ...args: any[]) {
    if (this.debug) {
      console.log(`[VSCode-MCP] ${message}`, ...args);
    }
  }

  async openFile(filePath: string, line?: number): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
    try {
      const absolutePath = resolve(this.workspaceRoot, filePath);
      this.log(`Opening file: ${absolutePath}${line ? ` at line ${line}` : ''}`);
      
      // Build VSCode command
      let command = `code "${absolutePath}"`;
      if (line) {
        command = `code --goto "${absolutePath}:${line}"`;
      }

      this.log(`Executing command: ${command}`);
      await execAsync(command);
      
      return {
        content: [{
          type: 'text',
          text: `Successfully opened ${filePath}${line ? ` at line ${line}` : ''} in VSCode`
        }]
      };
    } catch (error) {
      throw new Error(`Failed to open file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async runTerminalCommand(command: string, cwd?: string): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
    try {
      const workingDir = cwd ? resolve(this.workspaceRoot, cwd) : this.workspaceRoot;
      
      // Use VSCode's integrated terminal by opening a new terminal and sending the command
      const terminalScript = `
        tell application "System Events"
          tell application "Visual Studio Code" to activate
          delay 0.5
          keystroke "\`" using {control down}
          delay 0.5
          keystroke "${command.replace(/"/g, '\\"')}"
          keystroke return
        end tell
      `;

      // For Linux, we'll use a different approach - execute directly and show in VSCode terminal
      const { stdout, stderr } = await execAsync(command, { 
        cwd: workingDir,
        env: process.env 
      });

      const output = stdout + (stderr ? `\nSTDERR: ${stderr}` : '');
      
      // Also try to open a terminal in VSCode (this works if VSCode is already open)
      try {
        await execAsync(`code --command "workbench.action.terminal.new"`);
      } catch {
        // Ignore if VSCode command fails
      }

      return {
        content: [{
          type: 'text',
          text: `Command executed: ${command}\n\nOutput:\n${output}`
        }]
      };
    } catch (error) {
      throw new Error(`Failed to execute command: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async createFile(filePath: string, content: string): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
    try {
      const absolutePath = resolve(this.workspaceRoot, filePath);
      const dir = dirname(absolutePath);
      
      // Ensure directory exists
      await mkdir(dir, { recursive: true });
      
      // Write file
      await writeFile(absolutePath, content, 'utf8');
      
      // Open in VSCode
      await this.openFile(filePath);
      
      return {
        content: [{
          type: 'text',
          text: `Successfully created file ${filePath} and opened in VSCode`
        }]
      };
    } catch (error) {
      throw new Error(`Failed to create file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async searchWorkspace(query: string, type: 'files' | 'content'): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
    try {
      if (type === 'files') {
        // Search for files by name
        const files = await glob(`**/*${query}*`, {
          cwd: this.workspaceRoot,
          ignore: ['node_modules/**', '.git/**', 'dist/**', 'build/**'],
          onlyFiles: true
        });
        
        return {
          content: [{
            type: 'text',
            text: `Found ${files.length} files matching "${query}":\n${files.join('\n')}`
          }]
        };
      } else {
        // Search for content using ripgrep or grep
        try {
          const { stdout } = await execAsync(`rg --type-not binary -n "${query}" .`, {
            cwd: this.workspaceRoot
          });
          
          return {
            content: [{
              type: 'text',
              text: `Content search results for "${query}":\n${stdout}`
            }]
          };
        } catch (rgError) {
          // Fallback to grep if ripgrep not available
          try {
            const { stdout } = await execAsync(`grep -r -n --exclude-dir=node_modules --exclude-dir=.git "${query}" .`, {
              cwd: this.workspaceRoot
            });
            
            return {
              content: [{
                type: 'text',
                text: `Content search results for "${query}":\n${stdout}`
              }]
            };
          } catch (grepError) {
            throw new Error('Neither ripgrep nor grep available for content search');
          }
        }
      }
    } catch (error) {
      throw new Error(`Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getWorkspaceFiles(): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
    try {
      const files = await glob('**/*', {
        cwd: this.workspaceRoot,
        ignore: ['node_modules/**', '.git/**', 'dist/**', 'build/**', '**/*.{jpg,jpeg,png,gif,bmp,ico,svg}'],
        onlyFiles: true
      });

      const fileList = files.map(file => ({
        path: file,
        size: 'unknown',
        type: 'file'
      }));

      return {
        contents: [{
          uri: 'vscode://workspace/files',
          mimeType: 'application/json',
          text: JSON.stringify(fileList, null, 2)
        }]
      };
    } catch (error) {
      throw new Error(`Failed to get workspace files: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getCurrentEditorContent(): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
    try {
      // This is a limitation - we can't easily get the current editor content without a VSCode extension
      // For now, we'll return a message explaining this limitation
      return {
        contents: [{
          uri: 'vscode://editor/content',
          mimeType: 'text/plain',
          text: 'Current editor content access requires VSCode extension. This feature will be implemented in the extension component.'
        }]
      };
    } catch (error) {
      throw new Error(`Failed to get editor content: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async revealInExplorer(filePath: string): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
    try {
      const absolutePath = resolve(this.workspaceRoot, filePath);
      
      // Check if file exists
      try {
        await access(absolutePath);
      } catch {
        throw new Error(`File does not exist: ${filePath}`);
      }

      // Use VSCode command to reveal file in explorer
      const command = `code --command "revealFileInOS" "${absolutePath}"`;
      await execAsync(command);

      // Also try to reveal in VSCode's file explorer
      const revealCommand = `code --command "workbench.files.action.showActiveFileInExplorer" "${absolutePath}"`;
      try {
        await execAsync(revealCommand);
      } catch {
        // If that fails, try alternative command
        const altCommand = `code --command "explorer.openToSide" "${absolutePath}"`;
        await execAsync(altCommand);
      }

      return {
        content: [{
          type: 'text',
          text: `Successfully revealed ${filePath} in file explorer`
        }]
      };
    } catch (error) {
      throw new Error(`Failed to reveal file in explorer: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async focusExplorer(): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
    try {
      // Focus the file explorer view
      const command = `code --command "workbench.view.explorer"`;
      await execAsync(command);

      return {
        content: [{
          type: 'text',
          text: 'Successfully focused file explorer in VSCode'
        }]
      };
    } catch (error) {
      throw new Error(`Failed to focus explorer: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async selectFileInExplorer(filePath: string): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
    try {
      const absolutePath = resolve(this.workspaceRoot, filePath);
      this.log(`Selecting file in explorer: ${absolutePath}`);
      
      // Check if file exists
      try {
        await access(absolutePath);
      } catch {
        throw new Error(`File does not exist: ${filePath}`);
      }

      // Single command approach to avoid opening multiple VSCode instances
      // Open the file and reveal it in explorer in one go
      const command = `code "${absolutePath}" --command "workbench.files.action.showActiveFileInExplorer"`;
      this.log(`Executing command: ${command}`);
      await execAsync(command);

      return {
        content: [{
          type: 'text',
          text: `Successfully selected ${filePath} in VSCode file explorer`
        }]
      };
    } catch (error) {
      this.log(`Error selecting file: ${error}`);
      throw new Error(`Failed to select file in explorer: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}