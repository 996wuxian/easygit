import { describe, expect, it } from 'vitest';
import { formatCheckoutError, formatFetchError, formatStageError, gitErrorMessage } from './gitErrors';

describe('暂存失败的中文提示', () => {
  it.each(["sites/easygit-launch/", "宣传站/项目 launch/", "site's launch/"])('解释未检出提交的嵌套仓库并保留路径：%s', path => {
    const raw = `error: '${path}' does not have a commit checked out\nfatal: adding files failed`;
    for (const error of [raw, new Error(raw)]) {
      const message = formatStageError(error);
      expect(message).toContain(`“${path}”是嵌套的 Git 仓库`);
      expect(message).toContain('首次提交');
      expect(message).toContain('.gitignore');
      expect(message).not.toMatch(/does not have a commit|adding files failed/);
    }
  });

  it('其他失败保留原始原因并加上暂存上下文', () => {
    expect(formatStageError(new Error('文件路径无效。'))).toBe('暂存失败：文件路径无效。');
  });
});

describe('远程更新失败的中文提示', () => {
  it('将实际连接失败错误转换为原因与处理建议，不在主提示中展示整段英文及仓库地址', () => {
    const raw = "fatal: unable to access 'https://codehub-devops.cidc-rp-2215.4c-beta.cmecloud.cn/group/project.git/': Failed to connect to codehub-devops.cidc-rp-2215.4c-beta.cmecloud.cn port 443 after 21096 ms: Couldn't connect to server";
    expect(formatFetchError(raw)).toBe('获取远程更新失败：无法连接远程 Git 服务器。请检查网络、VPN 或代理设置，并确认服务器可以访问。');
    expect(gitErrorMessage(new Error(raw))).toBe(raw);
    expect(formatFetchError(new Error(raw))).toBe(formatFetchError(raw));
  });
  it.each([
    ['Could not resolve host: git.example.com', '无法解析远程服务器地址'],
    ['ssh: Could not resolve hostname git.example.com', '无法解析远程服务器地址'],
    ['Could not resolve proxy: proxy.example.com', '无法解析代理服务器地址'],
    ['Connection timed out after 21096 milliseconds', '连接远程服务器超时'],
    ['SSL certificate problem: unable to get local issuer certificate', '安全证书验证失败'],
    ['Authentication failed for https://example.com/repo.git', '身份验证失败'],
    ['git@example.com: Permission denied (publickey).', '身份验证失败'],
    ['The requested URL returned error: 401', '身份验证失败'],
    ['The requested URL returned error: 403', '服务器拒绝访问'],
    ['The requested URL returned error: 404', '找不到远程仓库'],
    ['HTTP/2 503', '远程服务器暂时异常'],
    ['The requested URL returned error: 502', '远程服务器暂时异常'],
    ['Connection reset by peer', '连接中断'],
    ['fatal: unexpected unknown failure', '原始错误详情'],
  ])('为 %s 提供对应中文说明', (raw, expected) => {
    expect(formatFetchError(raw)).toContain(expected);
    expect(formatFetchError(raw)).not.toContain(raw);
  });
});

describe('切换分支失败的中文提示', () => {
  const raw = 'error: Your local changes to the following files would be overwritten by checkout: package-lock.json Please commit your changes or stash them before you switch branches. Aborting';

  it.each([raw, new Error(raw)])('翻译本地修改会被覆盖的提示并保留文件名：%s', error => {
    expect(formatCheckoutError(error)).toBe('切换分支失败：以下文件有尚未提交的本地修改，切换分支会覆盖这些修改：package-lock.json。请先提交修改，或在“暂存架”面板中临时保存更改后再切换。');
  });

  it('保留多行输出中的中文文件名和带空格的路径', () => {
    const result = formatCheckoutError('error: Your local changes to the following files would be overwritten by checkout:\r\n\tpackage-lock.json\r\n\t文档/项目 notes.md\r\nPlease commit your changes or stash them before you switch branches.\r\nAborting');
    expect(result).toContain('package-lock.json、文档/项目 notes.md');
    expect(result).not.toMatch(/Your local changes|Please commit|Aborting/);
  });

  it('未跟踪文件给出备份或包含新文件的暂存架建议', () => {
    const result = formatCheckoutError('error: The following untracked working tree files would be overwritten by checkout:\n\tnew.txt\nPlease move or remove them before you switch branches.\nAborting');
    expect(result).toContain('未跟踪的本地文件会被目标分支的文件覆盖：new.txt');
    expect(result).toContain('包含未跟踪的新文件');
    expect(result).not.toContain('Please move');
  });

  it('保留已有中文提示和其他错误信息', () => {
    for (const message of ['请先解决冲突文件。', 'fatal: invalid reference: missing']) expect(formatCheckoutError(new Error(message))).toBe(message);
  });
});
