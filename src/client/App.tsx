import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine, ArrowRight, CalendarDays, Check, ChevronDown, CircleHelp,
  Clock3, Coffee, Coins, ExternalLink, Info, Leaf, LoaderCircle, Radar, RefreshCw,
  ShieldCheck, SlidersHorizontal, Ticket, TriangleAlert, X,
} from 'lucide-react';
import { addDays, beijingDay, dateDay, formatItemDate, sortItems, urgency } from '../shared/dates';
import { CATEGORY_LABELS, type AppConfig, type Category, type Mode, type RadarItem, type Snapshot } from '../shared/model';

const icons = { coupon: Ticket, points: Coins, campaign: CalendarDays };
const sourceLabels: Record<string, string> = {
  'now-time-info': '时间校准', 'query-my-coupons': '我的优惠券',
  'query-my-account': '积分风险', 'campaign-calendar': '活动日历',
};

async function post(path: string, body: object): Promise<Response> {
  const response = await fetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Radar-Request': '1' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(typeof error.message === 'string' ? error.message : '请求失败，请重试。');
  }
  return response;
}

function label(item: RadarItem, now: string): string {
  const status = urgency(item, now);
  if (status === 'unknown') return '日期待核实';
  if (status === 'past') return item.category === 'campaign' ? '已开始 / 已过日期' : '已过期';
  if (status === 'today') return item.category === 'campaign' ? '今日活动' : '今天到期';
  const days = Math.round((Date.parse(dateDay(item.date!) + 'T00:00:00Z') - Date.parse(beijingDay(now) + 'T00:00:00Z')) / 86_400_000);
  return item.category === 'campaign' ? `${days} 天后活动` : `${days} 天后到期`;
}

export function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [mode, setMode] = useState<Mode>('demo');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [category, setCategory] = useState<Category | 'all'>('all');
  const [range, setRange] = useState('7');
  const [showPast, setShowPast] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [help, setHelp] = useState(false);
  const [tick, setTick] = useState(Date.now());
  const generation = useRef(0);
  const loadedAt = useRef(Date.now());
  const helpButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  async function load(nextMode: Mode) {
    const request = ++generation.current;
    setMode(nextMode);
    setSnapshot(null);
    setSelected(new Set());
    setError('');
    setNotice('');
    setLoading(true);
    try {
      const response = await post('/api/snapshot', { mode: nextMode });
      const data: Snapshot = await response.json();
      if (request !== generation.current) return;
      loadedAt.current = Date.now();
      setTick(Date.now());
      setSnapshot(data);
    } catch (caught) {
      if (request === generation.current) setError(caught instanceof Error ? caught.message : '网络请求失败。');
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    void fetch('/api/config').then(async (response) => {
      if (!response.ok) throw new Error('无法读取本地配置。');
      const value: AppConfig = await response.json();
      if (active) { setConfig(value); await load('demo'); }
    }).catch(() => {
      if (active) { setError('无法连接本地服务，请确认服务已启动后刷新页面。'); setLoading(false); }
    });
    const timer = window.setInterval(() => setTick(Date.now()), 30_000);
    return () => { active = false; generation.current++; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (help) dialog.current?.showModal();
    else dialog.current?.close();
  }, [help]);

  const now = snapshot ? new Date(Date.parse(snapshot.now) + Math.max(0, tick - loadedAt.current)).toISOString() : new Date(tick).toISOString();
  const items = snapshot?.items ?? [];
  const active = items.filter((item) => urgency(item, now) !== 'past');
  const soon = active.filter((item) => item.category !== 'campaign' && ['today', 'soon'].includes(urgency(item, now)));
  const unknown = active.filter((item) => !item.date);
  const campaigns = active.filter((item) => item.category === 'campaign');
  const visible = useMemo(() => sortItems(items.filter((item) => {
    if (category !== 'all' && item.category !== category) return false;
    const state = urgency(item, now);
    if (state === 'past') return showPast;
    return range === 'all' || !item.date || dateDay(item.date) <= addDays(beijingDay(now), Number(range));
  })), [items, category, range, showPast, now]);
  const selectedItems = items.filter((item) => selected.has(item.id));
  const hiddenSelected = selectedItems.filter((item) => !visible.some((row) => row.id === item.id)).length;
  const issues = snapshot?.sources.filter((source) => !['ok', 'empty'].includes(source.state)) ?? [];
  const businessSources = snapshot?.sources.filter((source) => source.tool !== 'now-time-info') ?? [];
  const unavailable = businessSources.length > 0 && businessSources.every((source) => ['error', 'unsupported'].includes(source.state));
  const dateLabel = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date(now));

  function toggle(id: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function exportCalendar() {
    if (!snapshot) return;
    setExporting(true); setNotice('');
    try {
      const response = await post('/api/calendar', { snapshotId: snapshot.id, ids: [...selected] });
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `mcd-radar-${mode}.ics`;
      document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('日历文件已生成。导入后请检查时区与提醒设置；重复导入的处理取决于日历客户端。');
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : '日历导出失败。');
    } finally { setExporting(false); }
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#radar-list">跳到待办清单</a>
      <header className="topbar">
        <a className="brand" href="/" aria-label="麦麦到期雷达首页">
          <span className="brand-mark"><Radar size={25} strokeWidth={2.3} /></span>
          <span>麦麦到期雷达<small>MCD EXPIRY RADAR</small></span>
        </a>
        <nav aria-label="主导航">
          <a href="#radar-list" className="nav-active">我的雷达</a>
          <button ref={helpButton} onClick={() => setHelp(true)}><CircleHelp size={16} /> 使用指南</button>
          <a className="github-link" href="https://github.com/Guoan-Tang/mcd-expiry-radar" target="_blank" rel="noreferrer">开源项目 <ExternalLink size={14} /></a>
        </nav>
        <div className="readonly"><span /> 只读连接</div>
      </header>

      <main>
        <div className={`mode-banner ${mode}`} role="status">
          {mode === 'demo' ? <Info size={17} /> : <ShieldCheck size={17} />}
          <p><strong>{mode === 'demo' ? '演示数据' : '真实 MCP 模式'}</strong>
            <span>{mode === 'demo' ? '以下均为合成示例，不代表你的账户、真实优惠或正在进行的活动。' : '只调用官方查询工具。未识别或失败的数据不会用演示结果补齐。'}</span></p>
          <button onClick={() => setHelp(true)}>了解数据来源 <ArrowRight size={15} /></button>
        </div>

        <section className="hero" aria-labelledby="hero-heading">
          <div className="hero-copy">
            <div className="eyebrow"><span className="tiny-line" /> 少一点遗忘，多一点从容</div>
            <h1 id="hero-heading">让优惠不再悄悄过期<span className="hero-dot">.</span></h1>
            <p>优惠券、积分风险、活动日期，一眼看清。<br />只提醒你在意的，<strong>不为到期而消费。</strong></p>
            <div className="hero-meta"><span><ShieldCheck size={15} /> 只查询，不下单</span><i /><span><CalendarDays size={15} /> 一键带走提醒</span><i /><span>本地运行</span></div>
          </div>
          <div className="radar-art" aria-hidden="true">
            <div className="orbit orbit-outer" /><div className="orbit orbit-middle" /><div className="orbit orbit-inner" />
            <div className="radar-axis x" /><div className="radar-axis y" />
            <div className="radar-sweep" />
            <div className="radar-center"><Radar size={33} /></div>
            <div className="radar-float float-ticket"><Ticket size={20} /><span>优惠到期<strong>心中有数</strong></span><span className="signal" /></div>
            <div className="radar-float float-calendar"><CalendarDays size={20} /><span>留给日历<small>留点时间给自己</small></span></div>
            <span className="orbit-point one" /><span className="orbit-point two" /><span className="art-label">YOUR LITTLE REMINDER</span>
          </div>
        </section>

        <section className="workspace-bar" aria-label="数据与连接">
          <div className="today"><span className="live-dot" /><strong>{dateLabel}</strong><span>北京时间</span></div>
          <div className="connection-controls">
            <div className="mode-switch" aria-label="数据模式">
              <button aria-pressed={mode === 'demo'} onClick={() => void load('demo')}>体验演示</button>
              <button aria-pressed={mode === 'live'} onClick={() => void load('live')}>真实账户{!config?.liveAvailable && <span className="config-dot" />}</button>
            </div>
            <button className="refresh-button" disabled={loading} onClick={() => void load(mode)}><RefreshCw size={15} className={loading ? 'spin' : ''} />{loading ? '查询中' : '刷新数据'}</button>
          </div>
        </section>

        <div className="stats-grid" aria-label="账户摘要">
          <div className="stat-card"><div className="stat-top"><span>7 天内优惠 / 积分到期</span><Ticket size={19} /></div><div className="stat-value">{loading || !snapshot || unavailable ? '—' : soon.length}<small>项</small><span className="stat-tag">优先关注</span></div><p>不含活动日期，不把活动当成到期风险</p></div>
          <div className="stat-card"><div className="stat-top"><span>日期待核实</span><CircleHelp size={19} /></div><div className="stat-value">{loading || !snapshot || unavailable ? '—' : unknown.length}<small>项</small></div><p>没有明确日期，不替你猜一个截止日</p></div>
          <div className="stat-card"><div className="stat-top"><span>即将到来的活动</span><CalendarDays size={19} /></div><div className="stat-value">{loading || !snapshot || unavailable ? '—' : campaigns.length}<small>场</small></div><p>只记录活动日期，不代表可享优惠</p></div>
        </div>

        {error && <div className="error-box" role="alert"><TriangleAlert size={21} /><div><strong>{mode === 'live' ? '真实查询尚未完成' : '暂时无法加载'}</strong><p>{error}</p></div><button onClick={() => setHelp(true)}>配置指南 <ArrowRight size={15} /></button></div>}

        <div className="content-grid">
          <section className="list-panel" id="radar-list" aria-labelledby="list-heading">
            <div className="panel-heading"><div><span className="section-kicker">YOUR RADAR</span><h2 id="list-heading">你的到期待办 <span>{visible.length}</span></h2></div><span className="sort-note"><SlidersHorizontal size={14} /> 按日期从近到远</span></div>
            <div className="filters">
              <div className="category-tabs" aria-label="类别筛选">
                {(['all', 'coupon', 'points', 'campaign'] as const).map((value) => <button key={value} aria-pressed={category === value} onClick={() => setCategory(value)}>{value === 'all' ? '全部' : CATEGORY_LABELS[value]}</button>)}
              </div>
              <div className="range-select"><select aria-label="时间范围" value={range} onChange={(event) => setRange(event.target.value)}><option value="7">未来 7 天</option><option value="30">未来 30 天</option><option value="all">所有日期</option></select><ChevronDown size={13} /></div>
            </div>
            <div className="list-options"><span>日期待核实项始终保留</span><label><input type="checkbox" checked={showPast} onChange={(event) => setShowPast(event.target.checked)} /> 包含已过日期</label></div>
            <div className="items" aria-busy={loading}>
              {loading ? <div className="empty-state"><LoaderCircle className="spin" size={28} /><h3>{mode === 'live' ? '正在向官方 MCP 只读查询' : '正在整理演示雷达'}</h3><p>真实查询可能需要约一分钟，不会自动降级为演示。</p></div>
                : !snapshot ? <div className="empty-state"><Radar size={32} /><h3>等待一次明确的查询</h3><p>配置好 Token 后刷新真实账户，或主动切换到体验演示。</p></div>
                : unavailable ? <div className="empty-state"><TriangleAlert size={30} /><h3>暂时无法确认账户内容</h3><p>查询失败或返回格式未识别，不等同于没有优惠。请查看下方数据来源。</p></div>
                : visible.length === 0 ? <div className="empty-state"><Coffee size={32} /><h3>这个范围内没有待办</h3><p>{issues.length ? '部分来源尚未完整解析，请同时查看数据来源。' : '可以换一个筛选范围，也可以把时间留给自己。'}</p></div>
                : visible.map((item) => {
                  const Icon = icons[item.category];
                  const state = urgency(item, now);
                  return <article className={`item-card ${item.category} ${state} ${selected.has(item.id) ? 'selected' : ''}`} key={item.id}>
                    <div className="item-icon"><Icon size={22} strokeWidth={1.7} /></div>
                    <div className="item-main"><div className="item-label">{CATEGORY_LABELS[item.category]}<span className={`urgency ${state}`}>{label(item, now)}</span></div><h3>{item.title}</h3><p>{item.note}</p><div className="item-date"><Clock3 size={12} />{formatItemDate(item)}{item.date?.precision === 'instant' && ' · 北京时间'}</div></div>
                    <label className={`select-item ${!item.date ? 'disabled' : ''}`} title={item.date ? '选入日历清单' : '缺少明确日期，不能导出'}>
                      <input type="checkbox" aria-label={`选择${item.title}`} disabled={!item.date} checked={selected.has(item.id)} onChange={() => toggle(item.id)} />
                      <span><Check size={14} /></span><small>{item.date ? '提醒我' : '待核实'}</small>
                    </label>
                  </article>;
                })}
            </div>
            <div className="list-footnote"><Info size={13} /><span>以上均为查询快照，不保证仍可用。没有需要，让它自然过期也没关系。</span></div>
          </section>

          <aside className="sidebar" aria-label="提醒清单">
            <section className="calendar-panel">
              <span className="calendar-icon"><CalendarDays size={24} /></span>
              <div className="section-kicker">TAKE IT WITH YOU</div><h2>把提醒留给日历</h2><p className="calendar-intro">勾选你真正需要的项目，<br />给未来的自己一个轻提醒。</p>
              <div className="selection-summary"><span>已选择</span><strong>{selected.size}<small>项提醒</small></strong></div>
              {selected.size > 0 ? <div className="chosen-items">{selectedItems.map((item) => <div key={item.id}><span className={`chosen-dot ${item.category}`} /><span>{item.title}</span><button aria-label={`移除${item.title}`} onClick={() => toggle(item.id)}><X size={13} /></button></div>)}</div> : <div className="empty-selection"><span className="dashed-check"><Check size={14} /></span>从左侧勾选，开始整理</div>}
              {hiddenSelected > 0 && <p className="selection-note">包含 {hiddenSelected} 个不在当前筛选中的已选项目。</p>}
              <button className="export-button" disabled={selected.size === 0 || exporting} onClick={() => void exportCalendar()}>{exporting ? <LoaderCircle size={16} className="spin" /> : <ArrowDownToLine size={16} />}导出日历 .ics <ArrowRight size={16} /></button>
              {selected.size > 0 && <button className="clear-selection" onClick={() => setSelected(new Set())}>清空选择</button>}
              <div className="export-details"><span><Check size={13} /> 日期型条目导出为全天事件</span><span><Check size={13} /> 默认提前 1 天提醒</span><span><Check size={13} /> 适用于支持 ICS 的日历</span></div>
              <p className="calendar-caution">今天的项目可能已错过默认提醒。导入后请手动确认提醒时间。{mode === 'demo' && <strong> 演示导出也带有「演示数据」标记。</strong>}</p>
            </section>
            <section className="gentle-note"><span><Leaf size={18} /> 一个小约定</span><h3>省下的，不只是优惠。</h3><p>提醒是为了减少遗忘，不是增加消费。先看需要，再看优惠。</p><div className="note-line" /></section>
          </aside>
        </div>

        {notice && <div className="notice" role="status"><Info size={17} /><p>{notice}</p><button aria-label="关闭通知" onClick={() => setNotice('')}><X size={16} /></button></div>}
        <details className="source-panel" open={mode === 'live' && issues.length > 0 ? true : undefined}>
          <summary><span><ShieldCheck size={16} /> 数据来源与查询状态</span><span>{snapshot ? `${issues.length ? '部分信息待核实' : '查询已完成'} · ${snapshot.clock === 'official' ? '官方时间' : '本机时间'}` : '尚无查询结果'} <ChevronDown size={15} /></span></summary>
          <div className="sources">
            {snapshot?.sources.map((source) => <div className="source-row" key={source.tool}><span className={`source-dot ${source.state}`} /><div><strong>{sourceLabels[source.tool]}</strong><code>{source.tool}</code></div><p>{source.message}</p></div>)}
            <p className="source-disclaimer">{snapshot && <>快照：{new Date(snapshot.fetchedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}（北京时间）。</>}真实模式先发现并校验工具 schema；字段适配尚需真实账户联调验证。未知结构不会被解释为零余额或无优惠。快照仅在本机内存中保留最多 15 分钟。</p>
          </div>
        </details>
      </main>

      <footer><span><Radar size={17} /> 麦麦到期雷达 <span className="footer-separator">/</span> 把注意力，留给更重要的事。</span><p>独立开发 · 非麦当劳官方产品 · 信息以官方渠道为准</p></footer>
      <dialog ref={dialog} onCancel={() => setHelp(false)} onClose={() => { setHelp(false); helpButton.current?.focus(); }} aria-labelledby="help-heading">
        <div className="help-heading"><h2 id="help-heading">从演示到你的真实账户</h2><button aria-label="关闭指南" onClick={() => setHelp(false)}><X size={20} /></button></div>
        <p>应用始终先打开演示，真实查询由你主动触发。Token 只放在本机服务端，不在网页里输入。</p>
        <ol><li>在官方 <a href="https://open.mcd.cn/mcp" target="_blank" rel="noreferrer">MCP 开放平台</a> 登录并申请 Token。</li><li>把仓库中的 <code>.env.example</code> 复制为 <code>.env</code>，在本地编辑 <code>MCD_MCP_TOKEN</code>。只填原始 Token，不加 Bearer；不要分享该文件。</li><li>重启本地服务，点击「真实账户」。查询失败会明确报告，绝不自动改成演示数据。</li><li>勾选有日期的项目并导出 .ics。导入自己的日历后，确认提前提醒是否符合需要。</li></ol>
        <div className="help-note"><ShieldCheck size={19} /><p>不会领券、兑换、抽奖或下单。未提供日期的积分仅作为风险提示，不能导出提醒。普通文字或未知返回结构需要核实，不能当成“没有数据”。</p></div>
        <p className="muted">不需要额外付费 LLM 服务。支持 Skill 的客户端可按各自规范安装仓库中的技能；不同客户端的安装路径和配置格式可能不同。</p>
      </dialog>
    </div>
  );
}
