/**
 * node --test .claude/hooks/agentviz-emit.test.mjs
 *
 * Regression check for the "(prompt not recorded)" bug: a prompt whose first
 * line is blank must not be reported as empty.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFields } from './agentviz-emit.mjs';

test('a prompt starting with a leading blank line still captures its real first line', () => {
  const fields = buildFields({ prompt: '\nActual objective text starts on line two.' });
  assert.equal(fields.prompt, 'Actual objective text starts on line two.');
  assert.equal(fields.prompt_truncated, false);
});

test('a normal single-line prompt is captured as before', () => {
  const fields = buildFields({ prompt: 'a normal one-line prompt' });
  assert.equal(fields.prompt, 'a normal one-line prompt');
  assert.equal(fields.prompt_truncated, false);
});

test('a genuine multi-line prompt still marks prompt_truncated', () => {
  const fields = buildFields({ prompt: 'first line\nsecond line' });
  assert.equal(fields.prompt, 'first line');
  assert.equal(fields.prompt_truncated, true);
});

test('a task-notification prompt shows its summary, not the raw opening tag', () => {
  const prompt = [
    '<task-notification>',
    '<task-id>a03a27ca14421b2d9</task-id>',
    '<status>completed</status>',
    '<summary>Agent "Investigate curator-vs-agent AGENT_STOP emission" finished</summary>',
    '</task-notification>',
  ].join('\n');
  const fields = buildFields({ prompt });
  assert.equal(fields.prompt, 'Background task: Agent "Investigate curator-vs-agent AGENT_STOP emission" finished');
  assert.equal(fields.prompt_truncated, true);
});

test('a task-notification with no <summary> still gets a readable label', () => {
  const fields = buildFields({ prompt: '<task-notification>\n<status>completed</status>\n</task-notification>' });
  assert.equal(fields.prompt, 'Background task: a background task finished');
});

test('a prompt that is entirely a pasted block gets a readable label instead of the opening tag', () => {
  const fields = buildFields({ prompt: '<pasted_content id="9bf3">\nsome long pasted objective text\nacross several lines\n</pasted_content>' });
  assert.equal(fields.prompt, 'Pasted content');
  assert.equal(fields.prompt_truncated, true);
});

test('a pasted block alongside real instruction text surfaces the real text', () => {
  const fields = buildFields({ prompt: 'Please review this:\n<pasted_content id="1">\nlots of pasted text\n</pasted_content>\nand let me know what you think' });
  assert.equal(fields.prompt, 'Please review this: and let me know what you think');
  assert.equal(fields.prompt_truncated, true);
});
