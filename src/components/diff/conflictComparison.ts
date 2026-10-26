import type { ComparisonRow, SourceLine } from './model';

const MAX_COMPARISON_CELLS = 250_000;

function sourceLines(content: string): string[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

// Compare the editable block locally; the complete file comparison uses index snapshots.
export function buildConflictBlockRows(ours: string, theirs: string): ComparisonRow[] {
  const original = sourceLines(ours);
  const modified = sourceLines(theirs);
  const rows: ComparisonRow[] = [];
  let prefix = 0;
  while (prefix < Math.min(original.length, modified.length) && original[prefix] === modified[prefix]) {
    rows.push({ original: { number: prefix + 1, text: original[prefix], kind: 'context' }, modified: { number: prefix + 1, text: modified[prefix], kind: 'context' } });
    prefix++;
  }
  let originalEnd = original.length;
  let modifiedEnd = modified.length;
  while (originalEnd > prefix && modifiedEnd > prefix && original[originalEnd - 1] === modified[modifiedEnd - 1]) {
    originalEnd--;
    modifiedEnd--;
  }

  let removed: SourceLine[] = [];
  let added: SourceLine[] = [];
  const flush = () => {
    for (let index = 0; index < Math.max(removed.length, added.length); index++) {
      const left = removed[index];
      const right = added[index];
      rows.push(left && right && left.text === right.text
        ? { original: { ...left, kind: 'context' }, modified: { ...right, kind: 'context' } }
        : { original: left ?? null, modified: right ?? null });
    }
    removed = [];
    added = [];
  };
  const originalCount = originalEnd - prefix;
  const modifiedCount = modifiedEnd - prefix;
  const stride = modifiedCount + 1;
  const cells = (originalCount + 1) * stride;
  // Bound both memory and work for unusually large blocks; retain the shared edges.
  if (originalCount && modifiedCount && cells <= MAX_COMPARISON_CELLS) {
    const lengths = new Uint32Array(cells);
    for (let left = originalCount - 1; left >= 0; left--) {
      for (let right = modifiedCount - 1; right >= 0; right--) {
        lengths[left * stride + right] = original[prefix + left] === modified[prefix + right]
          ? lengths[(left + 1) * stride + right + 1] + 1
          : Math.max(lengths[(left + 1) * stride + right], lengths[left * stride + right + 1]);
      }
    }
    let left = 0;
    let right = 0;
    while (left < originalCount || right < modifiedCount) {
      if (left < originalCount && right < modifiedCount && original[prefix + left] === modified[prefix + right]) {
        flush();
        rows.push({
          original: { number: prefix + left + 1, text: original[prefix + left], kind: 'context' },
          modified: { number: prefix + right + 1, text: modified[prefix + right], kind: 'context' },
        });
        left++;
        right++;
      } else if (left < originalCount && (right === modifiedCount || lengths[(left + 1) * stride + right] >= lengths[left * stride + right + 1])) {
        removed.push({ number: prefix + left + 1, text: original[prefix + left], kind: 'removed' });
        left++;
      } else {
        added.push({ number: prefix + right + 1, text: modified[prefix + right], kind: 'added' });
        right++;
      }
    }
  } else {
    removed = original.slice(prefix, originalEnd).map((text, index) => ({ number: prefix + index + 1, text, kind: 'removed' }));
    added = modified.slice(prefix, modifiedEnd).map((text, index) => ({ number: prefix + index + 1, text, kind: 'added' }));
  }
  flush();
  while (originalEnd < original.length && modifiedEnd < modified.length) {
    rows.push({
      original: { number: originalEnd + 1, text: original[originalEnd], kind: 'context' },
      modified: { number: modifiedEnd + 1, text: modified[modifiedEnd], kind: 'context' },
    });
    originalEnd++;
    modifiedEnd++;
  }
  return rows;
}

export function getLineHighlight(text: string, other: string) {
  const characters = Array.from(text);
  const otherCharacters = Array.from(other);
  let start = 0;
  while (start < Math.min(characters.length, otherCharacters.length) && characters[start] === otherCharacters[start]) start++;
  let end = characters.length;
  let otherEnd = otherCharacters.length;
  while (end > start && otherEnd > start && characters[end - 1] === otherCharacters[otherEnd - 1]) { end--; otherEnd--; }
  return { before: characters.slice(0, start).join(''), changed: characters.slice(start, end).join(''), after: characters.slice(end).join('') };
}
