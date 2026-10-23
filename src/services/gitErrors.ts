export function gitErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function formatFetchError(error: unknown): string {
  const message = gitErrorMessage(error);
  const prefix = '获取远程更新失败：';
  const httpStatus = message.match(/(?:HTTP[^\r\n]*?\b|requested URL returned error:\s*)([45]\d{2})\b/i)?.[1];
  if (/could not resolve proxy/i.test(message)) return `${prefix}无法解析代理服务器地址。请检查代理设置。`;
  if (/could not resolve host|name or service not known|getaddrinfo/i.test(message)) return `${prefix}无法解析远程服务器地址。请检查网络、DNS 或 VPN 连接。`;
  if (/SSL certificate|certificate verify failed|server certificate verification failed|schannel:.*(?:certificate|trust)/i.test(message)) return `${prefix}远程服务器的安全证书验证失败。请检查系统时间，或联系管理员配置可信证书。`;
  if (httpStatus === '401' || /authentication failed|could not read username|terminal prompts disabled|permission denied \(publickey\)/i.test(message)) return `${prefix}身份验证失败。请检查账号、访问令牌或 SSH 密钥是否有效。`;
  if (httpStatus === '403' || /access denied/i.test(message)) return `${prefix}服务器拒绝访问。请确认账号具有此仓库的访问权限。`;
  if (httpStatus === '404' || /repository[^\r\n]*not found|does not appear to be a git repository/i.test(message)) return `${prefix}找不到远程仓库。请检查仓库地址及访问权限。`;
  if (/timed? out|timeout|超时/i.test(message)) return `${prefix}连接远程服务器超时。请检查网络、VPN 或代理设置，稍后重试。`;
  if (/failed to connect|couldn't connect|could not connect|connection refused|network is unreachable|no route to host|\boffline\b/i.test(message)) return `${prefix}无法连接远程 Git 服务器。请检查网络、VPN 或代理设置，并确认服务器可以访问。`;
  if (/connection reset|remote end hung up|unexpected disconnect|empty reply from server/i.test(message)) return `${prefix}与远程服务器的连接中断。请检查网络连接，稍后重试。`;
  if (httpStatus?.startsWith('5')) return `${prefix}远程服务器暂时异常。请稍后重试，或联系服务器管理员。`;
  if (/^(?:此仓库|请|无法|未找到|仓库)/.test(message)) return `${prefix}${message}`;
  return `${prefix}请检查远程仓库地址、网络连接及访问权限。可在“操作记录”中展开原始错误详情。`;
}

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
