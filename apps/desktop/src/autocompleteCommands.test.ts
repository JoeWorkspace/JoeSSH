import { describe, expect, it } from 'vitest';
import { terminalAutocompleteCommands } from './autocompleteCommands';

describe('terminalAutocompleteCommands', () => {
  it('is a non-empty readonly array of strings', () => {
    expect(terminalAutocompleteCommands.length).toBeGreaterThan(0);
    for (const cmd of terminalAutocompleteCommands) {
      expect(typeof cmd).toBe('string');
      expect(cmd.trim()).toBeTruthy();
    }
  });

  it('contains no duplicates', () => {
    const unique = new Set(terminalAutocompleteCommands);
    expect(unique.size).toBe(terminalAutocompleteCommands.length);
  });

  it('includes common commands', () => {
    const cmds = [...terminalAutocompleteCommands];
    expect(cmds).toContain('kubectl get pods');
    expect(cmds).toContain('docker ps');
    expect(cmds).toContain('git status');
    expect(cmds).toContain('ssh -L');
    expect(cmds).toContain('whoami');
  });

  it('contains well-formed entries (no empty strings, no leading/trailing whitespace)', () => {
    for (const cmd of terminalAutocompleteCommands) {
      expect(cmd).toBe(cmd.trim());
      expect(cmd.length).toBeGreaterThan(0);
    }
  });
});
