#!/usr/bin/env node

const { authenticateAccount, listAccounts, removeAccount } = require('./src/auth/manager');

// Parse command line arguments
const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case 'list':
    listAccounts();
    // Don't print JSON since listAccounts already prints formatted output
    break;
  case 'add':
    if (!args[1]) {
      console.error('Please provide an account ID: node auth.js add <account-id>');
      process.exit(1);
    }
    authenticateAccount(args[1]);
    break;
  case 'remove':
    if (!args[1]) {
      console.error('Please provide an account ID: node auth.js remove <account-id>');
      process.exit(1);
    }
    const result = removeAccount(args[1]);
    if (result.success) {
      console.log(result.message);
    } else {
      console.error(result.error);
      process.exit(1);
    }
    break;
  case undefined:
  case '':
    authenticateAccount('default');
    break;
  default:
    console.log('Usage: node auth.js [list|add <account-id>|remove <account-id>]');
    console.log('  list                - List all accounts');
    console.log('  add <account-id>    - Add a new account with the specified ID');
    console.log('  remove <account-id> - Remove an existing account with the specified ID');
    console.log('  (no arguments)      - Authenticate default account');
    process.exit(1);
}