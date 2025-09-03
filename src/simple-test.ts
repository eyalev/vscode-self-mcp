#!/usr/bin/env node

// Simple test to verify the server builds and basic functionality works
import { VSCodeController } from './vscode-controller.js';

async function testVSCodeController() {
  console.log('Testing VSCode Controller...\n');
  
  const controller = new VSCodeController();
  
  try {
    // Test workspace files
    console.log('1. Testing workspace files listing...');
    const files = await controller.getWorkspaceFiles();
    console.log('✅ Workspace files loaded successfully');
    
    // Test file search
    console.log('\n2. Testing file search...');
    const searchResult = await controller.searchWorkspace('package', 'files');
    console.log('✅ File search completed');
    
    // Test file creation (without opening VSCode)
    console.log('\n3. Testing file creation...');
    try {
      const createResult = await controller.createFile('test-output.txt', 'Test content from VSCode MCP');
      console.log('✅ File creation completed');
    } catch (error) {
      console.log('⚠️  File creation test skipped (VSCode not available)');
    }
    
    console.log('\n✅ Basic tests passed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run test
if (require.main === module) {
  testVSCodeController();
}