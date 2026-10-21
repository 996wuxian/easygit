import { invokeCommand } from './git';
import { flushStorage } from './storage';

export interface AiCommitSettings {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export async function generateCommitMessage(settings: AiCommitSettings, diff: string): Promise<string> {
  await flushStorage();
  return invokeCommand<string>('generate_commit_message', {
    baseUrl: settings.baseUrl,
    model: settings.model,
    diff,
  });
}

export function parseGeneratedCommitMessage(response: string): string {
  const content = response.trim().replace(/^```(?:\w+)?\s*|\s*```$/g, '');
  const message = content
    .split(/\r?\n/)
    .map(line => line.trim().replace(/^(?:[-*]\s+)?/, '').replace(/^['"“”`]+|['"“”`]+$/g, '').trim())
    .find(line => line.length > 0);
  if (!message || !/^[a-z][a-z0-9-]*(?:\([^)]+\))?!?:\s+\S/.test(message)) {
    throw new Error('AI 返回的提交信息格式不规范，请重试。');
  }
  return message;
}
