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
  // Reasoning and introductory prose are not part of the commit subject.
  const content = response.replace(/<(think|analysis)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(?:think|analysis)\b[^>]*>[\s\S]*$/gi, '');
  for (const line of content.split(/\r?\n/)) {
    const candidate = line.trim()
      .replace(/^(?:#{1,6}\s+|[-*+]\s+|\d+[.)、]\s*)/, '')
      .replace(/^(?:提交信息|commit message)\s*[:：]\s*/i, '')
      .replace(/^[\s'"“”‘’`*]+|[\s'"“”‘’`*]+$/g, '');
    const match = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(?:\(([^()\r\n]+)\))?(!)?\s*[:：]\s*(\S.*)$/i.exec(candidate);
    if (!match) continue;
    const [, type, scope, breaking = '', description] = match;
    if (scope !== undefined && !scope.trim()) continue;
    return `${type.toLowerCase()}${scope ? `(${scope.trim()})` : ''}${breaking}: ${description.trim()}`;
  }
  throw new Error('AI 未返回有效的提交信息，请重试或手动填写，例如 feat: 添加功能。');
}
