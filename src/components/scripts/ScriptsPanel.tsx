import { useEffect, useRef, useState } from 'react';
import { IconLoader2, IconPlayerPlay, IconRefresh, IconTerminal2 } from '@tabler/icons-react';
import type { RepositorySnapshot } from '../../services/git';
import { project, type ProjectScript, type ProjectScriptsInfo } from '../../services/project';
import { useOverflowTooltip } from '../OverflowTooltip';
import './scripts.css';

type ScriptState = { path: string; info?: ProjectScriptsInfo; loading: boolean; manual?: boolean; error?: string };
const runnableName = (name: string) => /^[\p{L}\p{N}:._/@-]+$/u.test(name) && !name.startsWith('-');

export function ScriptsPanel({ snapshot, notify }: { snapshot: RepositorySnapshot; notify: (message: string, error?: boolean) => void }) {
  const [state, setState] = useState<ScriptState | null>(null);
  const [reload, setReload] = useState(0);
  const [launching, setLaunching] = useState<string | null>(null);
  const [lastLaunch, setLastLaunch] = useState('');
  const launchRef = useRef(false);
  const mounted = useRef(true);
  const lastReload = useRef(reload);
  const overflow = useOverflowTooltip();
  useEffect(() => { overflow.hide(); }, [snapshot.path]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let cancelled = false;
    const path = snapshot.path;
    const manual = lastReload.current !== reload;
    lastReload.current = reload;
    setState(current => ({ ...(current?.path === path ? current : { path }), loading: true, manual }));
    void project.scripts(path).then(info => {
      if (!cancelled) setState({ path, info, loading: false });
    }).catch(error => {
      if (!cancelled) setState(current => ({ ...(current?.path === path ? current : { path }), loading: false, manual: false, error: String(error) }));
    });
    return () => { cancelled = true; };
  }, [snapshot, reload]);

  const current = state?.path === snapshot.path ? state : null;
  const info = current?.info;
  const loading = !current || current.loading;
  const showLoading = loading && ((!info && !current?.error) || Boolean(current?.manual));
  const footer = current?.error && info ? '刷新失败，保留上次读取的脚本；可点击刷新重试' : lastLaunch ? `已打开终端：${lastLaunch}` : '在项目目录打开终端，保留命令输出';
  const showScriptTooltip = (row: HTMLElement, script: ProjectScript) => overflow.show(row, `${script.name}\n${script.command}`, 'strong, code', `script:${script.name}`);
  const launch = async (script: ProjectScript) => {
    if (launchRef.current || showLoading || !info || !runnableName(script.name)) return;
    launchRef.current = true;
    setLaunching(script.name);
    try {
      await project.runScript(snapshot.path, script, info.manager);
      if (mounted.current) {
        const command = `${info.manager} run ${script.name}`;
        setLastLaunch(command);
        notify(`已打开终端执行 ${command}`);
      }
    } catch (error) { if (mounted.current) notify(`启动脚本失败：${String(error)}`, true); }
    finally { launchRef.current = false; if (mounted.current) setLaunching(null); }
  };

  return <div className="project-scripts-content" aria-busy={loading}>
    <div className="project-scripts-toolbar"><span><IconTerminal2 size={14} /><code>package.json</code>{info?.packageFound && <><b>{info.manager}</b><small>{info.scripts.length} 个脚本</small></>}</span><button className="icon-button" aria-label="刷新项目脚本" disabled={showLoading || launching !== null} onClick={() => setReload(value => value + 1)}><IconRefresh size={15} className={showLoading ? 'spin' : ''} /></button></div>
    {current?.error && !info ? <div className="project-scripts-empty" role="alert"><IconTerminal2 size={25} /><strong>无法读取项目脚本</strong><span>{current.error}</span></div> : !info ? <div className="project-scripts-empty"><IconLoader2 size={24} className="spin" /><span>正在读取项目脚本…</span></div> : !info.packageFound || !info.scripts.length ? <div className="project-scripts-empty"><IconTerminal2 size={27} stroke={1.4} /><strong>{info.packageFound ? '没有配置运行脚本' : '未找到 package.json'}</strong><span>{info.packageFound ? '在 package.json 的 scripts 中添加脚本后刷新。' : '当前项目根目录没有 package.json。'}</span></div> : <div className="project-scripts-list" aria-label="项目运行脚本">{info.scripts.map(script => <div className="project-script-row" key={script.name}
      aria-describedby={overflow.describedBy(`script:${script.name}`)} onMouseEnter={event => showScriptTooltip(event.currentTarget, script)} onMouseLeave={overflow.hide}
      onFocus={event => showScriptTooltip(event.currentTarget, script)} onBlur={overflow.hide}>
      <div><strong>{script.name}</strong><code>{script.command}</code></div>
      <button className="icon-button project-script-run" aria-label={`运行脚本 ${script.name}`} aria-description={runnableName(script.name) ? `在终端运行 ${info.manager} run ${script.name}` : '脚本名包含终端不支持的特殊字符'} disabled={showLoading || launching !== null || !runnableName(script.name)} onClick={() => { overflow.hide(); void launch(script); }}>{launching === script.name ? <IconLoader2 className="spin" size={17} /> : <IconPlayerPlay size={17} />}</button>
    </div>)}</div>}
    <div className={`project-scripts-footer ${current?.error && info ? 'refresh-error' : ''}`} role="status" aria-describedby={overflow.describedBy('footer')}
      onMouseEnter={event => overflow.show(event.currentTarget, current?.error ? `${footer}\n${current.error}` : footer, '.project-scripts-footer', 'footer')} onMouseLeave={overflow.hide}>{footer}</div>
    {overflow.tooltip}
  </div>;
}
