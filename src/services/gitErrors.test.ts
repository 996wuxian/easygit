import { describe, expect, it } from 'vitest';
import { formatFetchError, gitErrorMessage } from './gitErrors';

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
