/** Explain pull blockers while keeping the affected paths visible. */
export function formatPullError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const localChanges = message.match(/Your local changes to the following files would be overwritten by merge:([\s\S]*?)(?:Please commit your changes or stash them before you merge\.|Aborting\b|$)/i);
  if (localChanges) {
    return `拉取失败：以下文件有尚未提交的本地修改，拉取更新会覆盖这些修改${formatFiles(localChanges[1])}。请先提交修改，或在“暂存架”面板中临时保存更改后再拉取。`;
  }

  const untrackedFiles = message.match(/The following untracked working tree files would be overwritten by merge:([\s\S]*?)(?:Please move or remove them before you merge\.|Aborting\b|$)/i);
  if (untrackedFiles) {
    return `拉取失败：以下未跟踪的本地文件会被远程文件覆盖${formatFiles(untrackedFiles[1])}。请先将这些文件移到仓库外备份，或在“暂存架”面板中勾选“包含未跟踪的新文件”并保存更改后再拉取。`;
  }

  return `拉取失败：${message}`;
}

function formatFiles(files: string): string {
  const paths = files.split(/\r?\n/).map(path => path.trim()).filter(Boolean);
  return paths.length ? `：${paths.join('、')}` : '';
}
