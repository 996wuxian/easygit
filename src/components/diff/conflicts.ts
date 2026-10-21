export interface ConflictBlock { start: number; end: number; ours: string; theirs: string }

function marker(line: string, character: string, size: number, label = true) {
  const value = line.replace(/\r?\n$/, '');
  const prefix = character.repeat(size);
  return value.startsWith(prefix) && (value.length === size || label && value[size] === ' ');
}

export function hasConflictMarkers(content: string, size = 7) {
  return content.split('\n').some(line => ['<', '|', '=', '>'].some(character => marker(line.replace(/\r$/, ''), character, size, character !== '=')));
}

// Keep exact source slices so choosing a block preserves line endings and nearby edits.
export function parseConflictBlocks(content: string, size = 7): ConflictBlock[] {
  const lines = content.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const offsets = [0];
  for (const line of lines) offsets.push(offsets.at(-1)! + line.length);
  const blocks: ConflictBlock[] = [];
  for (let start = 0; start < lines.length; start++) {
    if (!marker(lines[start], '<', size)) continue;
    let base = -1;
    let divider = -1;
    let end = start + 1;
    for (; end < lines.length; end++) {
      if (marker(lines[end], '<', size)) break;
      if (divider < 0 && marker(lines[end], '|', size)) base = end;
      if (divider < 0 && marker(lines[end], '=', size, false)) divider = end;
      if (divider >= 0 && marker(lines[end], '>', size)) break;
    }
    if (divider < 0 || end >= lines.length || !marker(lines[end], '>', size)) continue;
    blocks.push({ start: offsets[start], end: offsets[end + 1], ours: content.slice(offsets[start + 1], offsets[base >= 0 ? base : divider]), theirs: content.slice(offsets[divider + 1], offsets[end]) });
    start = end;
  }
  return blocks;
}

export function acceptConflictBlock(content: string, block: ConflictBlock, side: 'ours' | 'theirs' | 'both') {
  return content.slice(0, block.start) + (side === 'both' ? block.ours + block.theirs : block[side]) + content.slice(block.end);
}
