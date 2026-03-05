import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import {
  toolRegistry,
  toolExists,
  getToolDefinitions,
  getPromptDefinitions,
  getPromptMessage,
  executeTool,
} from '../src/tools/registry.js';
import type { UnifiedTool } from '../src/tools/registry.js';
import type { ToolArguments } from '../src/constants.js';

function makeTool(overrides: Partial<UnifiedTool> = {}): UnifiedTool {
  return {
    name: overrides.name ?? 'Test Tool',
    description: overrides.description ?? 'A test tool',
    zodSchema: overrides.zodSchema ?? z.object({
      prompt: z.string().min(1),
    }),
    execute: overrides.execute ?? vi.fn().mockResolvedValue('result'),
    category: overrides.category ?? 'utility',
    prompt: overrides.prompt,
  };
}

describe('registry', () => {
  let savedRegistry: UnifiedTool[];

  beforeEach(() => {
    // Save and clear registry before each test
    savedRegistry = [...toolRegistry];
    toolRegistry.length = 0;
  });

  // Restore registry after each test
  afterEach(() => {
    toolRegistry.length = 0;
    toolRegistry.push(...savedRegistry);
  });

  describe('toolExists', () => {
    it('returns true for registered tools', () => {
      toolRegistry.push(makeTool({ name: 'My Tool' }));
      expect(toolExists('My Tool')).toBe(true);
    });

    it('returns false for unregistered tools', () => {
      expect(toolExists('Ghost Tool')).toBe(false);
    });
  });

  describe('getToolDefinitions', () => {
    it('converts zod schema to MCP Tool format', () => {
      const tool = makeTool({
        name: 'Ask-Gemini',
        description: 'Ask Gemini a question',
        zodSchema: z.object({
          prompt: z.string().describe('The prompt'),
          model: z.string().describe('Model ID'),
        }),
      });
      toolRegistry.push(tool);

      const defs = getToolDefinitions();
      expect(defs).toHaveLength(1);
      expect(defs[0].name).toBe('Ask-Gemini');
      expect(defs[0].description).toBe('Ask Gemini a question');
      expect(defs[0].inputSchema.type).toBe('object');
      expect(defs[0].inputSchema.properties).toHaveProperty('prompt');
      expect(defs[0].inputSchema.properties).toHaveProperty('model');
    });

    it('accepts a subset parameter', () => {
      const tool1 = makeTool({ name: 'Tool A' });
      const tool2 = makeTool({ name: 'Tool B' });
      const tool3 = makeTool({ name: 'Tool C' });
      toolRegistry.push(tool1, tool2, tool3);

      const defs = getToolDefinitions([tool1, tool3]);
      expect(defs).toHaveLength(2);
      expect(defs.map(d => d.name)).toEqual(['Tool A', 'Tool C']);
    });
  });

  describe('executeTool', () => {
    it('validates arguments with zod and rejects wrong types', async () => {
      const tool = makeTool({
        name: 'Strict Tool',
        zodSchema: z.object({
          prompt: z.string().min(1),
        }),
      });
      toolRegistry.push(tool);

      await expect(executeTool('Strict Tool', { prompt: '' } as ToolArguments))
        .rejects.toThrow('Invalid arguments');
    });

    it('passes validated args to execute function', async () => {
      const executeFn = vi.fn().mockResolvedValue('done');
      const tool = makeTool({
        name: 'Pass Through',
        zodSchema: z.object({ prompt: z.string() }),
        execute: executeFn,
      });
      toolRegistry.push(tool);

      await executeTool('Pass Through', { prompt: 'hello' } as ToolArguments);
      expect(executeFn).toHaveBeenCalledWith(
        { prompt: 'hello' },
        undefined
      );
    });

    it('throws on unknown tool name', async () => {
      await expect(executeTool('Nonexistent', {} as ToolArguments))
        .rejects.toThrow('Unknown tool: Nonexistent');
    });

    it('formats ZodError issues into readable message', async () => {
      const tool = makeTool({
        name: 'Multi Field',
        zodSchema: z.object({
          prompt: z.string(),
          model: z.string(),
        }),
      });
      toolRegistry.push(tool);

      try {
        await executeTool('Multi Field', {} as ToolArguments);
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.message).toContain('Invalid arguments for Multi Field');
        // Should mention the missing fields
        expect(err.message).toMatch(/prompt|model/);
      }
    });

    it('passes onProgress callback through to execute', async () => {
      const executeFn = vi.fn().mockImplementation(async (_args, onProgress) => {
        onProgress?.('update');
        return 'done';
      });
      const tool = makeTool({ name: 'Progress Tool', execute: executeFn });
      toolRegistry.push(tool);

      const onProgress = vi.fn();
      await executeTool('Progress Tool', { prompt: 'test' } as ToolArguments, onProgress);
      expect(onProgress).toHaveBeenCalledWith('update');
    });
  });

  describe('getPromptDefinitions', () => {
    it('only includes tools with prompt config', () => {
      const withPrompt = makeTool({
        name: 'Prompted',
        prompt: { description: 'A prompt' },
      });
      const withoutPrompt = makeTool({ name: 'No Prompt' });
      toolRegistry.push(withPrompt, withoutPrompt);

      const prompts = getPromptDefinitions();
      expect(prompts).toHaveLength(1);
      expect(prompts[0].name).toBe('Prompted');
    });

    it('extracts arguments from zod schema when not explicit', () => {
      const tool = makeTool({
        name: 'Auto Args',
        zodSchema: z.object({
          prompt: z.string().describe('The question'),
          model: z.string().describe('Model ID'),
        }),
        prompt: { description: 'Ask something' },
      });
      toolRegistry.push(tool);

      const prompts = getPromptDefinitions();
      expect(prompts[0].arguments).toBeDefined();
      expect(prompts[0].arguments!.length).toBeGreaterThanOrEqual(2);
      expect(prompts[0].arguments!.some(a => a.name === 'prompt')).toBe(true);
      expect(prompts[0].arguments!.some(a => a.name === 'model')).toBe(true);
    });
  });

  describe('getPromptMessage', () => {
    it('formats message with prompt and parameters', () => {
      const tool = makeTool({
        name: 'Ask-Gemini',
        prompt: { description: 'Ask Gemini' },
      });
      toolRegistry.push(tool);

      const msg = getPromptMessage('Ask-Gemini', {
        prompt: 'explain this',
        model: 'gemini-2.5-flash',
        sandbox: true,
      });

      expect(msg).toContain('Use the Ask-Gemini tool');
      expect(msg).toContain('explain this');
      expect(msg).toContain('model: gemini-2.5-flash');
      expect(msg).toContain('[sandbox]');
    });

    it('throws for tool without prompt definition', () => {
      const tool = makeTool({ name: 'No Prompt Tool' });
      toolRegistry.push(tool);

      expect(() => getPromptMessage('No Prompt Tool', {}))
        .toThrow('No prompt defined');
    });

    it('excludes false/undefined/null values', () => {
      const tool = makeTool({
        name: 'Filter Tool',
        prompt: { description: 'Test' },
      });
      toolRegistry.push(tool);

      const msg = getPromptMessage('Filter Tool', {
        prompt: 'test',
        sandbox: false,
        extra: undefined,
        nothing: null,
      });

      expect(msg).not.toContain('sandbox');
      expect(msg).not.toContain('extra');
      expect(msg).not.toContain('nothing');
    });
  });
});
