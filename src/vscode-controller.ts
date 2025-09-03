import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { readFile, writeFile, access, mkdir } from 'fs/promises';
import { dirname, resolve, join } from 'path';
import { glob } from 'fast-glob';

const execAsync = promisify(exec);

export class VSCodeController {
  private workspaceRoot: string;
  private debug: boolean;
  private workspaceCache: { data: Array<{ name: string; path: string }>; timestamp: number } | null = null;
  private readonly CACHE_DURATION = 5000; // 5 seconds cache

  constructor(debug: boolean = false) {
    this.workspaceRoot = process.cwd();
    this.debug = debug || process.env.VSCODE_MCP_DEBUG === 'true';
  }

  private log(message: string, ...args: any[]) {
    if (this.debug) {
      console.log(`[VSCode-MCP] ${message}`, ...args);
    }
  }

  private extractWorkspaceFromTitle(windowTitle: string): string | null {
    // VSCode window titles are typically: "filename - workspace - Visual Studio Code"
    // or "workspace - Visual Studio Code"
    const parts = windowTitle.split(' - ');
    if (parts.length >= 2) {
      // Remove "Visual Studio Code" from the end
      const withoutVSCode = parts.slice(0, -1);
      if (withoutVSCode.length >= 2) {
        // If there are 2+ parts, the workspace is usually the second-to-last
        return withoutVSCode[withoutVSCode.length - 1].trim();
      } else if (withoutVSCode.length === 1) {
        // If there's only one part, that's the workspace
        return withoutVSCode[0].trim();
      }
    }
    return null;
  }

  private async getOpenWorkspacesFast(): Promise<Array<{ name: string; path: string }>> {
    // Check cache first
    if (this.workspaceCache && (Date.now() - this.workspaceCache.timestamp < this.CACHE_DURATION)) {
      this.log(`Using cached workspace data`);
      return this.workspaceCache.data;
    }

    this.log(`Refreshing workspace data...`);
    const workspaces: Array<{ name: string; path: string }> = [];

    try {
      // Method 1: Fast - Get open VSCode windows using wmctrl
      const { stdout: wmctrlOutput } = await execAsync('wmctrl -l -x');
      const vscodeWindows = wmctrlOutput.split('\n').filter(line => 
        line.includes('code.Code') && line.includes('Visual Studio Code')
      );

      // Extract workspace names from window titles
      const windowWorkspaceNames: string[] = [];
      for (const window of vscodeWindows) {
        const parts = window.split(/\s+/);
        if (parts.length > 4) {
          const windowTitle = parts.slice(4).join(' ');
          const workspaceName = this.extractWorkspaceFromTitle(windowTitle);
          if (workspaceName && !windowWorkspaceNames.includes(workspaceName)) {
            windowWorkspaceNames.push(workspaceName);
          }
        }
      }

      this.log(`Found ${windowWorkspaceNames.length} workspace windows: ${windowWorkspaceNames.join(', ')}`);

      // Method 2: Fast - Read VSCode workspace storage to get paths
      const { stdout: storageFiles } = await execAsync('ls ~/.config/Code/User/workspaceStorage/*/workspace.json 2>/dev/null || echo ""');
      
      if (storageFiles.trim()) {
        const workspaceFiles = storageFiles.trim().split('\n');
        
        for (const workspaceFile of workspaceFiles) {
          try {
            const workspaceData = JSON.parse(await readFile(workspaceFile, 'utf8'));
            if (workspaceData.folder && workspaceData.folder.startsWith('file://')) {
              const workspacePath = workspaceData.folder.replace('file://', '');
              const workspaceName = workspacePath.split('/').pop() || '';
              
              // Only include workspaces that have open windows OR are recently used
              if (windowWorkspaceNames.some(winName => 
                winName.toLowerCase().includes(workspaceName.toLowerCase()) ||
                workspaceName.toLowerCase().includes(winName.toLowerCase())
              )) {
                try {
                  await access(workspacePath);
                  workspaces.push({
                    name: workspaceName,
                    path: workspacePath
                  });
                  this.log(`Added open workspace: ${workspaceName} -> ${workspacePath}`);
                } catch {
                  // Workspace path doesn't exist anymore
                }
              }
            }
          } catch {
            // Invalid JSON or file read error
          }
        }
      }

      // Cache the results
      this.workspaceCache = {
        data: workspaces,
        timestamp: Date.now()
      };

      this.log(`Fast method found ${workspaces.length} workspaces`);
      return workspaces;

    } catch (error) {
      this.log(`Fast method failed: ${error}, falling back to slow method`);
      // Fallback to the original slow method
      return this.parseVSCodeStatusSlow();
    }
  }

  private async parseVSCodeStatusSlow(): Promise<Array<{ name: string; path: string }>> {
    this.log('Using slow code --status method...');
    const { stdout } = await execAsync('code --status');
    return this.parseVSCodeStatus(stdout);
  }

  private async parseVSCodeStatus(statusOutput: string): Promise<Array<{ name: string; path: string }>> {
    const workspaces: Array<{ name: string; path: string }> = [];
    
    try {
      const lines = statusOutput.split('\n');
      let inWorkspaceStats = false;
      
      for (const line of lines) {
        // Look for workspace stats section
        if (line.includes('Workspace Stats:')) {
          inWorkspaceStats = true;
          continue;
        }
        
        if (!inWorkspaceStats) continue;
        
        // Stop if we hit another section or empty lines that suggest end of workspace stats
        if (line.trim() === '' && inWorkspaceStats) {
          // Check if this might be the end of workspace stats
          continue;
        }
        
        // Look for folder lines like: "    Folder (deb-helper): 2 files" or "|    Folder (deb-helper): 2 files"
        const folderMatch = line.match(/^\s*\|?\s*Folder \(([^)]+)\):/);
        if (folderMatch) {
          const folderName = folderMatch[1];
          this.log(`Found workspace folder: ${folderName}`);
          
          // Try to find the full path for this workspace
          const workspacePath = await this.findWorkspacePathByName(folderName);
          if (workspacePath) {
            workspaces.push({
              name: folderName,
              path: workspacePath
            });
            this.log(`Mapped ${folderName} to ${workspacePath}`);
          } else {
            this.log(`Could not find path for workspace: ${folderName}`);
          }
        }
      }
      
      this.log(`Parsed ${workspaces.length} workspaces from VSCode status`);
      return workspaces;
    } catch (error) {
      this.log(`Error parsing VSCode status: ${error}`);
      return [];
    }
  }

  private async findWorkspacePathByName(workspaceName: string): Promise<string | null> {
    try {
      // Check VSCode's workspace storage for exact matches
      try {
        const { stdout } = await execAsync('find ~/.config/Code/User/workspaceStorage -name "workspace.json"');
        const workspaceFiles = stdout.trim().split('\n');
        
        for (const workspaceFile of workspaceFiles) {
          try {
            const workspaceData = JSON.parse(await readFile(workspaceFile, 'utf8'));
            if (workspaceData.folder && workspaceData.folder.startsWith('file://')) {
              const workspacePath = workspaceData.folder.replace('file://', '');
              const pathName = workspacePath.split('/').pop() || '';
              
              if (pathName === workspaceName) {
                await access(workspacePath);
                this.log(`Found exact workspace path for ${workspaceName}: ${workspacePath}`);
                return workspacePath;
              }
            }
          } catch {
            // Invalid JSON or file read error, continue
          }
        }
      } catch {
        // find command failed
      }

      // Fallback: search common project directories
      const searchPaths = [
        `/home/ubuntu/projects/*/*/${workspaceName}`,
        `/home/ubuntu/projects/*/${workspaceName}`,
        `/home/ubuntu/${workspaceName}`
      ];

      for (const searchPath of searchPaths) {
        try {
          const { stdout } = await execAsync(`ls -d ${searchPath} 2>/dev/null | head -1`);
          if (stdout.trim()) {
            const path = stdout.trim();
            await access(path);
            this.log(`Found workspace path via search for ${workspaceName}: ${path}`);
            return path;
          }
        } catch {
          // Continue to next search path
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  private async getActiveVSCodeWorkspace(): Promise<string> {
    try {
      // Approach 1: Use fast workspace detection (most reliable and fast)
      try {
        const workspaces = await this.getOpenWorkspacesFast();
        
        if (workspaces.length > 0) {
          this.log(`Found ${workspaces.length} open VSCode workspaces: ${workspaces.map(w => w.name).join(', ')}`);
          
          // Try to determine which workspace is active
          // First, check if current working directory is within any workspace
          const currentDir = process.cwd();
          for (const workspace of workspaces) {
            if (currentDir.startsWith(workspace.path)) {
              this.log(`Current directory is within workspace: ${workspace.name}`);
              return workspace.path;
            }
          }
          
          // If not, return the first workspace (most recent or active)
          this.log(`Using first workspace: ${workspaces[0].name}`);
          return workspaces[0].path;
        }
      } catch (error) {
        this.log(`VSCode status command failed: ${error}`);
      }

      // Approach 2: Check for workspace indicators in current directory and parents
      let currentDir = process.cwd();
      const rootDir = '/';
      const homeDir = process.env.HOME || '/home/ubuntu';
      
      while (currentDir !== rootDir) {
        try {
          // Check for workspace indicators
          const indicators = ['.git', 'package.json', 'Cargo.toml', 'go.mod', 'pom.xml', 'pyproject.toml', '.vscode'];
          
          for (const indicator of indicators) {
            try {
              await access(join(currentDir, indicator));
              
              // Skip .vscode in home directory unless it has a settings.json with workspace-specific config
              if (indicator === '.vscode' && currentDir === homeDir) {
                try {
                  const settingsPath = join(currentDir, '.vscode', 'settings.json');
                  await access(settingsPath);
                  const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
                  // Only consider it a workspace if it has project-specific settings
                  if (Object.keys(settings).length === 0) {
                    continue;
                  }
                } catch {
                  // No settings.json or invalid JSON, skip this .vscode
                  continue;
                }
              }
              
              this.log(`Found workspace indicator ${indicator} in ${currentDir}`);
              return currentDir;
            } catch {
              // Indicator not found, continue
            }
          }
          
          // Move up one directory
          const parentDir = dirname(currentDir);
          if (parentDir === currentDir) {
            break; // Reached filesystem root
          }
          currentDir = parentDir;
        } catch {
          break;
        }
      }
      
      // Approach 3: Check VSCode's recent workspaces
      try {
        const { stdout } = await execAsync('ls -t ~/.config/Code/User/workspaceStorage/*/workspace.json');
        const workspaceFiles = stdout.trim().split('\n').slice(0, 3); // Get 3 most recent
        
        for (const workspaceFile of workspaceFiles) {
          try {
            const workspaceData = JSON.parse(await readFile(workspaceFile, 'utf8'));
            if (workspaceData.folder && workspaceData.folder.startsWith('file://')) {
              const workspacePath = workspaceData.folder.replace('file://', '');
              try {
                await access(workspacePath);
                this.log(`Found recent VSCode workspace: ${workspacePath}`);
                return workspacePath;
              } catch {
                // Workspace path doesn't exist anymore
              }
            }
          } catch {
            // Invalid JSON or file read error
          }
        }
      } catch {
        // Unable to read VSCode workspace storage
      }

      // Approach 4: Fallback to current working directory
      this.log('No workspace indicators or recent workspaces found, using current directory');
      return process.cwd();
    } catch (error) {
      this.log(`Failed to detect workspace: ${error}, falling back to cwd`);
      return process.cwd();
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

  async getActiveWorkspace(): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
    try {
      const activeWorkspace = await this.getActiveVSCodeWorkspace();
      
      return {
        content: [{
          type: 'text',
          text: `Active VSCode workspace: ${activeWorkspace}`
        }]
      };
    } catch (error) {
      throw new Error(`Failed to get active workspace: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getAllWorkspaces(): Promise<{ 
    content: Array<{ type: 'text'; text: string }>;
    workspaces: Array<{ name: string; path: string }>;
  }> {
    try {
      // Use fast workspace detection
      const workspaces = await this.getOpenWorkspacesFast();
      
      const workspaceText = workspaces.length > 0 
        ? `Open VSCode workspaces (${workspaces.length}):\n${workspaces.map(w => `  ${w.name} - ${w.path}`).join('\n')}`
        : 'No open VSCode workspaces found';
      
      return {
        content: [{
          type: 'text',
          text: workspaceText
        }],
        workspaces
      };
    } catch (error) {
      throw new Error(`Failed to get workspaces: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Expose the internal method for CLI JSON output
  getActiveVSCodeWorkspacePath(): Promise<string> {
    return this.getActiveVSCodeWorkspace();
  }

  async getWorkspaceInfo(workspaceName: string): Promise<{ 
    content: Array<{ type: 'text'; text: string }>;
    workspace: { name: string; path: string; status: string };
  }> {
    try {
      // Find the workspace by name using fast method
      const workspaces = await this.getOpenWorkspacesFast();
      
      const targetWorkspace = workspaces.find(w => 
        w.name.toLowerCase().includes(workspaceName.toLowerCase()) ||
        workspaceName.toLowerCase().includes(w.name.toLowerCase())
      );
      
      if (!targetWorkspace) {
        throw new Error(`Workspace '${workspaceName}' not found. Available workspaces: ${workspaces.map(w => w.name).join(', ')}`);
      }

      this.log(`Found workspace info for: ${targetWorkspace.name}`);

      // Check if this is the currently active workspace
      const activeWorkspace = await this.getActiveVSCodeWorkspace();
      const isActive = activeWorkspace === targetWorkspace.path;

      // Get basic file count info (optional enhancement)
      let fileCount = 'unknown';
      try {
        const { stdout: fileCountOutput } = await execAsync(`find "${targetWorkspace.path}" -type f 2>/dev/null | wc -l`);
        fileCount = fileCountOutput.trim();
      } catch {
        // Ignore file count errors
      }

      const status = isActive ? 'active' : 'open';
      const workspaceInfo = {
        name: targetWorkspace.name,
        path: targetWorkspace.path,
        status: status
      };

      return {
        content: [{
          type: 'text',
          text: `Workspace: ${targetWorkspace.name}\nPath: ${targetWorkspace.path}\nStatus: ${status}${fileCount !== 'unknown' ? `\nFiles: ~${fileCount}` : ''}`
        }],
        workspace: workspaceInfo
      };
    } catch (error) {
      this.log(`Error getting workspace info: ${error}`);
      throw new Error(`Failed to get workspace info: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async openTerminalInWorkspace(workspaceName?: string): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
    try {
      let targetWorkspacePath: string;
      
      if (workspaceName) {
        // Find the workspace by name using fast method
        const workspaces = await this.getOpenWorkspacesFast();
        
        const targetWorkspace = workspaces.find(w => 
          w.name.toLowerCase().includes(workspaceName.toLowerCase()) ||
          workspaceName.toLowerCase().includes(w.name.toLowerCase())
        );
        
        if (!targetWorkspace) {
          throw new Error(`Workspace '${workspaceName}' not found. Available workspaces: ${workspaces.map(w => w.name).join(', ')}`);
        }
        
        targetWorkspacePath = targetWorkspace.path;
        this.log(`Found target workspace: ${targetWorkspace.name} at ${targetWorkspacePath}`);
      } else {
        // Use active workspace
        targetWorkspacePath = await this.getActiveVSCodeWorkspace();
        this.log(`Using active workspace: ${targetWorkspacePath}`);
      }

      // Open VSCode with the workspace and create a new terminal
      const command = `code "${targetWorkspacePath}" --command "workbench.action.terminal.new"`;
      this.log(`Executing command: ${command}`);
      await execAsync(command);

      const workspaceName_display = workspaceName || 'active workspace';
      return {
        content: [{
          type: 'text',
          text: `Successfully opened terminal in ${workspaceName_display} (${targetWorkspacePath})`
        }]
      };
    } catch (error) {
      this.log(`Error opening terminal: ${error}`);
      throw new Error(`Failed to open terminal: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async focusWorkspace(workspaceName?: string): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
    try {
      let targetWorkspace: { name: string; path: string };
      
      if (workspaceName) {
        // Find the workspace by name using fast method
        const workspaces = await this.getOpenWorkspacesFast();
        
        const foundWorkspace = workspaces.find(w => 
          w.name.toLowerCase().includes(workspaceName.toLowerCase()) ||
          workspaceName.toLowerCase().includes(w.name.toLowerCase())
        );
        
        if (!foundWorkspace) {
          throw new Error(`Workspace '${workspaceName}' not found. Available workspaces: ${workspaces.map(w => w.name).join(', ')}`);
        }
        
        targetWorkspace = foundWorkspace;
        this.log(`Found target workspace: ${targetWorkspace.name} at ${targetWorkspace.path}`);
      } else {
        // Use active workspace - find it in the workspace list
        const activeWorkspacePath = await this.getActiveVSCodeWorkspace();
        const workspaces = await this.getOpenWorkspacesFast();
        
        const foundWorkspace = workspaces.find(w => w.path === activeWorkspacePath);
        if (!foundWorkspace) {
          throw new Error('Could not find active workspace in open workspaces list');
        }
        
        targetWorkspace = foundWorkspace;
        this.log(`Using active workspace: ${targetWorkspace.name}`);
      }

      // Method 1: Try to focus using wmctrl (Linux window manager control)
      try {
        // Get VSCode windows and find the one with matching workspace name
        const { stdout: wmctrlOutput } = await execAsync('wmctrl -l');
        const vscodeWindows = wmctrlOutput.split('\n').filter(line => 
          line.includes('Visual Studio Code') && line.includes(targetWorkspace.name)
        );
        
        if (vscodeWindows.length > 0) {
          // Extract window ID (first column)
          const windowId = vscodeWindows[0].split(/\s+/)[0];
          await execAsync(`wmctrl -i -a ${windowId}`);
          
          return {
            content: [{
              type: 'text',
              text: `Successfully focused workspace '${targetWorkspace.name}' window`
            }]
          };
        }
      } catch (wmctrlError) {
        this.log(`wmctrl method failed: ${wmctrlError}, trying alternative method`);
      }

      // Method 2: Fallback to opening the workspace (will bring it to focus)
      const command = `code "${targetWorkspace.path}"`;
      this.log(`Executing fallback command: ${command}`);
      await execAsync(command);

      return {
        content: [{
          type: 'text',
          text: `Focused workspace '${targetWorkspace.name}' (${targetWorkspace.path})`
        }]
      };
    } catch (error) {
      this.log(`Error focusing workspace: ${error}`);
      throw new Error(`Failed to focus workspace: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async selectFileInExplorer(filePath: string): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
    try {
      // Get the active VSCode workspace instead of using the CLI's working directory
      const activeWorkspace = await this.getActiveVSCodeWorkspace();
      this.log(`Using active workspace: ${activeWorkspace}`);
      
      // Resolve the file path relative to the active workspace
      const absolutePath = resolve(activeWorkspace, filePath);
      this.log(`Selecting file in explorer: ${absolutePath}`);
      
      // Check if file exists
      try {
        await access(absolutePath);
      } catch {
        // If file doesn't exist relative to workspace, try as absolute path
        if (!filePath.startsWith('/')) {
          throw new Error(`File does not exist: ${filePath} (looked in ${activeWorkspace})`);
        }
        
        // Try the file path as absolute
        try {
          await access(filePath);
        } catch {
          throw new Error(`File does not exist: ${filePath}`);
        }
      }

      // Use the correct absolute path (either workspace-relative or absolute)
      const finalPath = (await access(absolutePath).then(() => absolutePath).catch(() => filePath));
      
      // Single command approach to avoid opening multiple VSCode instances
      // Open the file and reveal it in explorer in one go
      const command = `code "${finalPath}" --command "workbench.files.action.showActiveFileInExplorer"`;
      this.log(`Executing command: ${command}`);
      await execAsync(command);

      return {
        content: [{
          type: 'text',
          text: `Successfully selected ${filePath} in VSCode file explorer (workspace: ${activeWorkspace})`
        }]
      };
    } catch (error) {
      this.log(`Error selecting file: ${error}`);
      throw new Error(`Failed to select file in explorer: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}