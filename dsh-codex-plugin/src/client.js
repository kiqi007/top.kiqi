import { enableReorder } from './reorder.js'
import { markdown, imageLink, copyText } from './markdown.js'
import { backgroundLibrary, composeImages } from './images.js'
import { makePreview } from './file-preview.js'
import launcherArt from './launcher.svg'

// DSH and the offline preview mount the same view. Each card keeps its own DOM
// and draft while other threads stream messages.
(() => {
  const paths = {
    copy:'<rect x="8.5" y="8.5" width="12" height="12" rx="2.8"/><path d="M15 8V5.7A2.2 2.2 0 0 0 12.8 3.5H5.7a2.2 2.2 0 0 0-2.2 2.2v7.1A2.2 2.2 0 0 0 5.7 15H8"/>',
    pencil:'<path d="m14.8 4.2 5 5M4 20l4.5-1 12-12a2 2 0 0 0-4.5-4.5l-12 12z"/>',
    check:'<path d="m4 12 5 5L20 6"/>',
    fast:'<path d="m13.5 2-9 12h6l-1 8 10-13h-6z" fill="currentColor" stroke="none"/>',
    picture:'<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="15.5" cy="8.5" r="1.5"/><path d="m4 16 5-5 7 7 2-2 3 3"/>',
    attach:'<path d="m8 13 7.6-7.6a3 3 0 0 1 4.3 4.2l-9.1 9.1a5 5 0 0 1-7.1-7.1L13.4 2"/>',
    windows:'<rect x="3" y="8" width="13" height="12" rx="2.5"/><path d="M8 8V5.5A2.5 2.5 0 0 1 10.5 3H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-3M6 12h7"/>',
    chevron:'<path d="m9 5 7 7-7 7"/>',
    close:'<path d="m6 6 12 12M6 18 18 6"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    up: '<path d="M12 19V5m-6 6 6-6 6 6"/>',
    shield: '<path d="m12 2 8 3v6c0 5-4 8-8 11-4-3-8-6-8-11V5z"/><path d="M12 7v6m0 3h.01"/>',
    expand: '<path d="M14 4h6v6m0-6-7 7M10 20H4v-6m0 6 7-7"/>',
  }
  const icon = (name, size = 16) => '<svg aria-hidden="true" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">' + paths[name] + '</svg>'
  const css = `
    :host {display:block;height:100%;min-height:0}
    * {box-sizing:border-box} [hidden] {display:none!important}
    .wall {--bg:#f7f8fa;--panel:#fff;--soft:#f3f4f6;--line:#e3e5e8;--ink:#191c1f;--muted:#656d77;--blue:#e8f3fe;--navy:#0c264a;--accent:#267454;--tint:#e9f5ed;--amber:#805019;--warm:#fff6e5;
      color:var(--ink);background:var(--bg);height:100%;overflow:hidden;container-type:inline-size;color-scheme:light;
      font:15px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased}
    .wall.dark {color-scheme:dark;--bg:#191b1e;--panel:#202226;--soft:#2a2c31;--line:#363a40;--ink:#eef0f2;--muted:#a1a8b2;--blue:#173e76;--navy:#f6fafe;--accent:#91ccaa;--tint:#28392f;--amber:#e6bf83;--warm:#372e20}
    button,input,textarea {font:inherit;color:inherit} button {cursor:pointer;border:1px solid var(--line);background:var(--panel);border-radius:8px;padding:6px 10px;display:inline-flex;align-items:center;justify-content:center;gap:6px}
    button:hover {background:var(--soft)} button:disabled {cursor:default;opacity:.5} :focus-visible {outline:2px solid #4f80b8;outline-offset:2px}
    .page {height:100%;display:flex;flex-direction:column;min-height:0}
    .headline,.actions,.stats,.state,.project,.cardhead,.row,.brand,.buttons,.tabbar,.tab {display:flex;align-items:center}
    .headline {flex:none;gap:12px;min-height:44px;padding:4px 11px;background:var(--panel);border-bottom:1px solid var(--line)}
    .brand {display:grid;place-items:center;width:24px;height:24px;border-radius:6px;background:var(--soft)}
    .choose {flex:none;border:0;padding:3px;gap:6px;font-weight:630;font-size:14px}.choose>svg {transform:rotate(90deg)}
    .stats {gap:5px;white-space:nowrap;font-size:11px;color:var(--muted)}.dot {width:6px;height:6px;border-radius:50%;background:currentColor;display:inline-block}.on {background:var(--accent)}
    .actions {gap:2px}.actions button {min-width:29px;min-height:29px}.bare {border:0;background:transparent;padding:5px;color:var(--muted)}
    .primary,.send {background:var(--ink);color:var(--panel);border-color:transparent}.primary:hover,.send:hover {background:var(--muted)}
    .tabbar {min-width:0;gap:5px;overflow:auto;flex:1;scrollbar-width:thin}
    .tab-slot {position:relative;display:flex;flex:0 1 auto;min-width:34px;max-width:175px}
    .tab {width:100%;min-width:0;height:26px;padding:2px 8px;border-radius:7px;font-size:12px;background:transparent;color:var(--muted)}
    .tab[aria-pressed=true] {color:var(--ink);background:var(--soft);border-color:color-mix(in srgb,var(--stripe) 48%,var(--line))}
    .tab .bar {width:6px;height:6px;border:1px solid currentColor;border-radius:50%;flex:none}.tab[aria-pressed=true] .bar {background:var(--stripe);border-color:var(--stripe)}.tab span:last-child {white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .unbind {position:absolute;inset:3px 3px 3px auto;width:20px;padding:0;border:0;border-radius:4px;background:transparent;color:inherit;opacity:0;pointer-events:none}
    .tab-slot:is(:hover,:focus-within) .unbind {opacity:1;pointer-events:auto}
    .tab-slot:is(:hover,:focus-within) .tab span:last-child {clip-path:inset(0 15px 0 0)}
    .unbind:hover,.unbind:focus-visible {background:color-mix(in srgb,var(--ink) 12%,transparent)}
    @media(hover:none){.tab-slot .unbind{opacity:1;pointer-events:auto}.tab-slot{min-width:66px}.tab-slot .tab{padding-inline-end:25px}.tab-slot:is(:hover,:focus-within) .tab span:last-child{clip-path:none}}
    @container(max-width:780px){.connection{display:none}.headline{gap:6px}.choose{font-size:12px}.stats{gap:3px}}
    .grid {display:grid;gap:7px;padding:7px;min-height:0;flex:1;grid-template-columns:repeat(var(--cols,1),minmax(0,1fr));grid-auto-rows:minmax(0,1fr)}
    .grid[data-count="4"] {--cols:2!important}.grid.focus {grid-template-columns:1fr;grid-template-rows:1fr}
    @container(min-width:1580px) {.grid[data-count="4"] {--cols:4!important}}
    @container (650px < width <= 970px) {.grid[data-count="3"]:not(.focus) {grid-template-columns:repeat(3,minmax(290px,1fr));overflow-x:auto}}
    @container(max-width:650px) {.grid:not(.focus) {grid-template-columns:none;grid-auto-flow:column;grid-auto-columns:100%;grid-template-rows:1fr;overflow-x:auto;scroll-snap-type:x mandatory}.card {scroll-snap-align:center}.headline{padding:3px 6px;gap:4px}.actions{gap:1px}.actions .choose{font-size:11px}.tabbar{padding:0}.stats .counts{display:none}}
    .card {border:1px solid var(--line);border-radius:10px;background:var(--panel);min-height:0;min-width:0;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 1px 3px #00000006}
    .cardhead {gap:6px;padding:5px 10px;border-bottom:1px solid var(--line);flex:none}
    .titles {min-width:0;flex:1;display:flex;align-items:baseline;gap:7px}.titles .project{min-width:0;max-width:36%}.titles h2{min-width:0}.project {gap:5px;color:var(--muted);font:11px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace}.project svg{flex:none}.project span,h2 {overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
    h2 {font-size:15px;font-weight:630;letter-spacing:-.025em;margin:0}
    .state {white-space:nowrap;gap:5px;border-radius:6px;padding:2px 6px;font-size:11px;background:var(--soft);color:var(--muted)}.state.running {color:var(--accent);background:var(--tint)}.state.pending {color:var(--amber);background:var(--warm)}.state .dot {width:5px;height:5px}.zoom {padding:4px}
    .stream {padding:16px clamp(13px,1.2vw,24px);min-height:0;overflow:auto;flex:1;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--line) transparent}
    .transcript-body{display:flow-root}
    .turn+.turn {margin-top:24px}.user {width:fit-content;max-width:70%;margin:0 0 0 auto;background:var(--blue);color:var(--navy);border-radius:22px;padding:11px 16px;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.65}
    .agent {overflow-wrap:anywhere;line-height:1.72;margin:11px 0 0}.rich p {margin:0 0 8px;white-space:pre-wrap}.rich p:last-child {margin-bottom:0}.rich strong {color:var(--ink)}.rich h3 {margin:10px 0 5px;font-size:1.04em}.rich li {margin:2px 0}.rich ul,.rich ol {padding-left:21px;margin:6px 0}.rich code,pre,.toolbody {font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9em}.rich code {background:var(--soft);padding:2px 4px;border-radius:4px}.rich pre,.toolbody {background:var(--soft);border-radius:7px;padding:7px 9px;white-space:pre-wrap;overflow-wrap:anywhere;margin:5px 0}.rich a {color:inherit;text-underline-offset:2px}
    .rich {white-space:normal;min-width:0}.rich :is(h1,h2,h3,h4,h5,h6){margin:8px 0 4px;white-space:normal;font-size:1.05em}.rich img {display:inline-block;max-width:100%;max-height:330px;object-fit:contain;vertical-align:middle}
    .rich .table-scroll{overflow-x:auto;max-width:100%;margin:12px 0}.rich table{border-collapse:separate;border-spacing:0;width:max-content;min-width:100%;font-size:.95em}.rich :is(th,td){vertical-align:top;text-align:start;padding:9px 24px 9px 0;max-width:30em;overflow-wrap:anywhere}.rich :is(th,td):last-child{padding-right:0}.rich th{font-weight:600;border-bottom:1px solid var(--muted);padding-block:8px}.rich tbody tr:not(:last-child) td{border-bottom:1px solid var(--line)}
    .rich :not(pre)>code{border-radius:6px;padding:1px 6px;font-size:.92em;box-decoration-break:clone}.code-block{background:var(--soft);border-radius:14px;margin:14px 0;overflow:hidden}.code-head{display:flex;align-items:center;justify-content:space-between;min-height:32px;padding:4px 9px 0 14px;font-size:12px;color:var(--muted)}.code-head button{border:0;padding:3px 6px;background:transparent;color:inherit;font-size:12px}.rich .code-block pre{overflow:auto;white-space:pre;overflow-wrap:normal;background:transparent;margin:0;padding:8px 14px 13px}
    .rich blockquote {border-left:2px solid var(--line);margin:6px 0;padding-left:10px;color:var(--muted)}.rich pre code{padding:0;background:transparent}.rich a {color:light-dark(#245587,#9dc8ef)}.rich p{white-space:normal}
    .rich {line-height:1.5}.rich p+p{margin-top:.72em}.rich :is(h1,h2,h3,h4){line-height:1.35;letter-spacing:-.015em;margin:.95em 0 .45em;font-weight:650;overflow:visible}.rich h1{font-size:1.55em}.rich h2{font-size:1.3em}.rich h3{font-size:1.12em}.rich>:first-child{margin-top:0}
    .rich a {color:light-dark(#0169cc,#76b4ff);text-decoration:none;font-weight:500}.rich a:hover,.rich a:focus-visible{text-decoration:underline;text-underline-offset:.15em}
    .file-link[data-file-kind]::before{content:"";display:inline-block;width:.9em;height:.9em;vertical-align:-.08em;margin-inline-end:.28em;background:currentColor;mask:var(--link-icon) center/contain no-repeat;--link-icon:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.4'%3E%3Cpath d='M3.5 1.5h6l3 3v10h-9zM9 1.5v4h3.5M6 8h4M6 11h4'/%3E%3C/svg%3E")}
    .file-link[data-file-kind=html]::before{--link-icon:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 18 16' fill='none' stroke='black' stroke-width='1.4'%3E%3Cpath d='m4 3-3 5 3 5m10-10 3 5-3 5m-4-11-3 12'/%3E%3C/svg%3E")}
    .file-link[data-file-kind=image]::before{--link-icon:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.4'%3E%3Crect x='1.5' y='1.5' width='13' height='13' rx='3'/%3E%3Ccircle cx='10.5' cy='5.5' r='1'/%3E%3Cpath d='m2 11 3.5-3 6 6'/%3E%3C/svg%3E")}
    .user .rich{font-size:14px;line-height:23px;letter-spacing:-.01em;font-weight:500}.user .rich p,.user .rich p+p{margin:0}.user .rich :is(ol,ul){margin:13px 0 0;padding-inline-start:30px}.user .rich li{margin:0}.user .rich .prompt-break{margin-top:23px}
    .stream{color:var(--ink)}.turn .agent .rich{font:500 14px/23px -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;letter-spacing:0}.turn .agent .rich strong{font-weight:650}.turn .rich :is(ul,ol) li::marker{font-variant-numeric:tabular-nums}.turn .agent .rich>p,.turn .agent .rich>:is(ul,ol){margin:0 0 14px}.turn .agent .rich :is(ul,ol){padding-inline-start:28px}.turn .agent .rich li{margin:0}.turn .agent .rich li>p{margin:0}.turn .agent .rich>:last-child{margin-bottom:0}
    .rich .file-link {font-weight:500}
    .message-unit{position:relative;min-width:0}.message-tools{--muted:light-dark(#8a9093,#a1a8b2);display:flex;align-items:center;gap:2px;height:26px;margin-top:4px;color:var(--muted);opacity:0;transition:opacity .12s}
    .user-unit .message-tools{justify-content:flex-end}.message-unit:hover .message-tools,.message-unit:focus-within .message-tools,.turn:last-child .agent-unit:last-child .message-tools{opacity:1}
    .message-tools time{font-variant-numeric:tabular-nums;font-size:12px;margin-inline:4px}.message-tools button{width:24px;height:24px;padding:4px;border:0;border-radius:6px;background:transparent;color:inherit}.message-tools button:hover{background:var(--soft);color:var(--ink)}
    .user-unit:has(.edit-form)>.user,.user-unit:has(.edit-form)>.message-tools{display:none}
    .edit-form{width:100%;padding:12px 14px;border-radius:20px;background:var(--soft)}.edit-form textarea{display:block;width:100%;height:auto;max-height:45vh;font:inherit;line-height:1.5}.edit-form small{display:block;color:var(--muted);margin:6px 0}.edit-form .buttons button{border-radius:999px;padding:5px 12px}
    @media(hover:none){.message-tools{opacity:1}}
    .media-strip{display:flex;flex-wrap:wrap;gap:8px;margin:.65em 0}.image-link,.rich a.image-link {display:inline-flex;vertical-align:middle;border-radius:10px;overflow:hidden;background:var(--soft);border:1px solid var(--line);cursor:zoom-in;max-width:100%;padding:0}.image-link img,.rich .image-link img{display:block;max-width:100%;max-height:220px;object-fit:contain}.image-link:hover{border-color:var(--muted)}
    .quota{float:right;color:var(--muted)}.row:has(input:disabled){opacity:.52;cursor:default}
    @container(max-width:650px){.headline:has(.tab-slot:nth-child(5)) .choose{font-size:0;gap:1px}.tab{min-width:23px;padding:2px 3px;gap:2px}.tabbar{gap:2px}}
    .grid:has(+.empty:not([hidden])){flex:none}.empty:not([hidden]){margin:auto}
    .work {margin:12px 0 16px;color:var(--muted);font-size:.93em}.work summary {cursor:pointer;width:fit-content;display:flex;align-items:center;gap:5px;list-style:none;padding:3px 0}.work summary::-webkit-details-marker {display:none}.chev {transition:transform .15s}.work[open] .chev{transform:rotate(90deg)}.work.live summary{color:var(--muted)}
    .steps {margin:8px 0 12px 5px;border-left:2px solid var(--line);padding-left:13px}.step+.step{margin-top:10px}.step {white-space:pre-wrap;overflow-wrap:anywhere}.step-label {display:flex;gap:6px;align-items:center;font-size:11px;font-weight:600}.toolbody {max-height:160px;overflow:auto;font-size:11px}.step p {margin:2px 0}.step-output {white-space:pre-wrap;margin:4px 0;font:11px/1.5 ui-monospace,Menlo,monospace;max-height:100px;overflow:auto}
    .empty,.alert,.carderror {padding:0 14px;font-size:12px;color:var(--muted)}.alert,.carderror {color:var(--amber)}.empty {margin:auto;text-align:center}.requests {max-height:40%;overflow:auto;flex:none}.approval {margin:3px 12px 8px;padding:9px 11px;border:1px solid color-mix(in srgb,var(--amber) 25%,var(--line));border-radius:9px;background:var(--warm)}
    .approval strong {color:var(--amber);display:flex;align-items:center;gap:6px;font-size:12px}.details {white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.5 ui-monospace,Menlo,monospace;margin:5px 0}
    .buttons {gap:6px;justify-content:flex-end}.buttons button {font-size:12px;padding:4px 9px}
    .composer {display:flex;align-items:flex-end;gap:6px;margin:8px 11px 11px;padding:6px 7px 6px 12px;border:1px solid var(--line);border-radius:13px;flex:none}.composer:focus-within {border-color:var(--muted)}
    textarea {resize:none;flex:1;min-width:0;border:0;outline:0!important;background:transparent;height:29px;padding:4px 0;font-family:inherit;font-size:14px;line-height:1.55}.send {width:29px;height:29px;border-radius:50%;padding:5px}.send:disabled {background:var(--soft);color:var(--muted);opacity:1}
    /* A full-width scrollport keeps the scrollbar at the window edge; only the reading column narrows. */
    .grid:is(.focus,[data-count="1"]) {--measure:46rem;--gutter:clamp(15px,3vw,40px);padding:0;background:var(--panel)}
    .grid:is(.focus,[data-count="1"]) .card {border:0;border-radius:0;box-shadow:none}
    .grid:is(.focus,[data-count="1"]) .stream {padding:clamp(18px,3vh,32px) 0}
    .grid:is(.focus,[data-count="1"]) :is(.turn,.composer,.requests,.carderror) {
      box-sizing:border-box;width:min(var(--measure),calc(100% - 2 * var(--gutter)));margin-inline:auto
    }
    .grid:is(.focus,[data-count="1"]) .turn {font-size:16px;line-height:1.72}
    .grid:is(.focus,[data-count="1"]) .turn+.turn {margin-top:30px}
    .grid:is(.focus,[data-count="1"]) .approval {margin-inline:0}
    .grid:is(.focus,[data-count="1"]) .composer {padding:9px 10px 9px 15px;margin-block:8px max(14px,env(safe-area-inset-bottom));box-shadow:0 2px 8px #14182108}
    .grid:is(.focus,[data-count="1"]) .cardhead {padding-inline:14px}
    .composer {background:var(--panel);border-radius:18px;box-shadow:0 2px 6px #00000008}.composer:focus-within{border-color:color-mix(in srgb,var(--ink) 35%,var(--line))}.composer textarea::placeholder{color:var(--muted)}.work summary:hover{color:var(--ink)}
    .headline,.cardhead,.tab {position:relative;isolation:isolate}
    .headline.working::after,.card[data-activity="running"] .cardhead::after {
      content:"";position:absolute;pointer-events:none;inset:auto 0 0;height:2px;background:linear-gradient(90deg,transparent 0%,transparent 37%,var(--flow,#69a1bb) 48%,#a3d7c0 51%,transparent 63%,transparent 100%);
      background-size:240% 100%;animation:title-flow 3.4s linear infinite
    }
    .tab {overflow:hidden}
    .tab[data-activity="pending"]{color:#754004;border-color:#d9922c;background:linear-gradient(100deg,#ffedc9,#ffd690,#fff0c9);background-size:200% 100%;animation:tab-flow 2.2s ease-in-out infinite alternate;font-weight:600}
    .tab[data-activity="pending"][aria-pressed=true]{box-shadow:inset 0 0 0 1px #be761c}
    .dark .tab[data-activity="pending"]{color:#ffe5ac;border-color:#b7833d;background-image:linear-gradient(100deg,#553718,#734a1b,#503519)}
    .tab[data-activity="pending"] .bar{display:grid;place-items:center;width:13px;height:13px;border:0;background:currentColor}
    .tab[data-activity="pending"] .bar::before{content:"!";color:#fff5dd;font:bold 10px/1 system-ui}
    .dark .tab[data-activity="pending"] .bar::before{color:#553718}
    .tab[data-activity="running"] .bar{background:var(--accent);border-color:var(--accent)}
    .tab[data-activity="running"] {
      color:#124f40;border-color:#5a9f88;font-weight:600;
      background:linear-gradient(105deg,#c2eade 0%,#a5ddcc 25%,#e4fbf0 44%,#b4e3ef 62%,#b0e1cf 82%,#c2eade 100%);
      background-size:240% 100%;animation:tab-flow 2.8s ease-in-out infinite alternate
    }
    .dark .tab[data-activity="running"]{color:#e4fff1;border-color:#65ac99;background-image:linear-gradient(105deg,#214f44,#306956 25%,#417c73 44%,#305e71 62%,#285f4e 82%,#214f44)}
    .tab[data-activity="running"][aria-pressed=true]{box-shadow:inset 0 0 0 1px var(--accent)}
    @keyframes tab-flow{from{background-position:0% 50%}to{background-position:100% 50%}}
    @media(prefers-reduced-motion:reduce){.tab:is([data-activity="running"],[data-activity="pending"]){animation:none;background-position:48% 50%}}
    .card[data-activity="running"] .cardhead {--flow:var(--stripe)}
    @keyframes title-flow {from{background-position:100% 0}to{background-position:-70% 0}}
    @media(prefers-reduced-motion:reduce){
      .headline.working::after,.card[data-activity="running"] .cardhead::after {animation:none;background:var(--accent);opacity:.45}
    }
    dialog {background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:15px;padding:18px;width:min(420px,90%);max-height:80%;box-shadow:0 12px 48px #0002}dialog::backdrop {background:#0004}dialog header {display:flex;align-items:center;justify-content:space-between;font-weight:600}dialog .rows {margin:12px 0;max-height:45vh;overflow:auto}.row {gap:9px;padding:8px 3px;cursor:pointer}.row input{accent-color:var(--accent)}.row span{overflow-wrap:anywhere}
    .wall{--default-wash:32%}.wall.dark{--default-wash:40%}
    .card.with-wallpaper{--wash:var(--background-wash,var(--default-wash));--veil:color-mix(in srgb,var(--panel) var(--wash),transparent);--text-surface:color-mix(in srgb,var(--panel) 72%,transparent);background-image:linear-gradient(var(--veil),var(--veil)),var(--wallpaper);background-size:cover;background-position:center}
    .with-wallpaper .cardhead,.with-wallpaper .response-surface,.with-wallpaper .message-tools{background-color:var(--text-surface)}
    .with-wallpaper .response-surface{margin-top:10px;padding:7px 10px;border-radius:9px;min-width:0}
    .with-wallpaper .response-surface:has(>.work:only-child[hidden]){display:none}
    .with-wallpaper .response-surface:has(>.work:only-child:not([open])){width:fit-content;max-width:100%}
    .with-wallpaper .response-surface>.work,.with-wallpaper .response-surface>.agent{margin:0}
    .with-wallpaper .response-surface>.work:not([hidden])+.agent{margin-top:6px}
    .with-wallpaper .message-tools{width:fit-content;max-width:100%;padding:0 4px;border-radius:7px;color:var(--ink)}
    .with-wallpaper .user-unit>.message-tools{margin-inline-start:auto}.message-tools:empty{display:none}
    .tab,.cardhead{touch-action:none;user-select:none;cursor:grab}.order-source{cursor:grabbing;opacity:.66}.order-target{outline:2px solid var(--accent);outline-offset:-2px}
    .preview-body>object{display:block;width:100%;height:calc(100% - 4rem)}
    .preview-source{margin:0 auto;max-width:100%;width:max-content;min-width:min(100%,48rem);padding:18px;line-height:1.55;white-space:pre;overflow:auto}.file-info{padding:24px}.file-save{display:inline-block;margin-top:8px;color:var(--ink)}.preview-body>.file-media{display:block;max-width:100%;max-height:100%;margin:auto}
    .cardhead{min-width:0}.cardhead .state{min-width:0;max-width:63%;color:var(--muted);background:transparent;padding:0;gap:5px}.model-info{display:inline-flex;align-items:center;gap:4px;min-width:0;font-size:12px;white-space:nowrap}.model-name{min-width:0;overflow:hidden;text-overflow:ellipsis;color:var(--ink);font-weight:500}.model-effort,.model-fast{flex:none}.model-fast{display:inline-flex;align-items:center}.state .dot{flex:none;width:7px;height:7px}.state.running .dot{color:var(--accent)}.state.pending .dot,.state.waiting .dot{color:var(--amber)}.state.error .dot{color:#c84f45}
    .work summary{max-width:100%;min-width:0}.work summary>span:first-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.work summary .chev{flex:none}
    .composer{flex-wrap:wrap}.composer .attach{width:27px;height:29px;padding:5px;flex:none}.image-drafts:not(:empty){display:flex;flex-wrap:wrap;width:100%;gap:6px;max-height:96px;overflow:auto}.image-drafts:empty{display:none}.draft-image{position:relative;height:42px;padding:0;overflow:hidden}.draft-image img{height:100%;max-width:70px;object-fit:cover}.draft-image:after{content:"×";position:absolute;right:0;top:0;padding:0 3px;background:#222a;color:white;font:12px/15px sans-serif}
    .background-dialog header small{margin-inline:auto 8px;color:var(--muted)}.background-dialog p{color:var(--muted);font-size:13px}.background-dialog p:empty{display:none}.gallery{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-top:12px}.gallery-tile{position:relative}.gallery-tile img{width:100%;height:60px;display:block;object-fit:cover;border-radius:8px}.gallery-tile button{position:absolute;right:3px;top:3px;border:0;background:#222a;color:white;border-radius:50%;width:20px;height:20px;padding:0}
    .gallery-tile{cursor:grab;touch-action:none;user-select:none;border-radius:8px}.gallery-tile.order-source{cursor:grabbing}
    .wash-control{display:flex;align-items:center;gap:9px;margin:14px 0;font-size:13px}.wash-control input{flex:1;min-width:45px;accent-color:var(--accent)}.wash-control output{min-width:4ch;text-align:end;font-variant-numeric:tabular-nums}
    .preview-dialog{width:min(1120px,96vw);max-width:96vw;height:min(860px,92dvh);max-height:94dvh;padding:0;overflow:hidden}
    .preview-dialog[open]{display:flex;flex-direction:column}.preview-dialog header{flex:none;gap:9px;border-bottom:1px solid var(--line);padding:7px 12px}.preview-dialog header strong{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px}
    .preview-body{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain}.preview-body>.rich{max-width:48rem;margin:auto;padding:26px clamp(15px,4vw,48px) 48px;font-size:16px}
    .preview-body iframe{width:100%;height:100%;display:block;border:0;background:white}.preview-dialog[data-kind=image] .preview-body{display:grid;place-items:center;background:var(--soft);padding:12px}.preview-body>img{display:block;max-width:100%;max-height:100%;object-fit:contain;min-height:0}
  `
  function node(tag, cls, text) {
    const el = document.createElement(tag)
    if (cls) el.className = cls
    if (text) el.textContent = text
    return el
  }
  function elapsed(ms) {
    if (!Number.isFinite(ms)) return ''
    const seconds = Math.max(1,Math.round(ms/1000)), minutes = Math.floor(seconds/60)
    return minutes ? minutes + ' 分钟' + (seconds % 60 ? ' ' + seconds % 60 + ' 秒' : '') : seconds + ' 秒'
  }
  // Phase-less replies occur in older rollouts. The last such reply remains
  // visible when that turn ends, unless a final answer was explicitly supplied.
  function splitTurn(items, live) {
    let finals = items.filter(m => m.role === 'agent' && m.phase === 'final_answer')
    if (!live && !finals.length) {
      const answer = items.findLast(m => m.role === 'agent' && m.phase !== 'commentary')
      if (answer) finals = [answer]
    }
    const users = items.filter(m => m.role === 'user')
    return {users, finals, steps:items.filter(m => m.role !== 'user' && !finals.includes(m))}
  }
  function toolbar(m, ms, edit) {
    const bar = node('div','message-tools')
    const date = new Date(ms)
    if (Number.isFinite(ms) && Number.isFinite(date.getTime())) {
      const time = node('time')
      time.dateTime = date.toISOString()
      time.textContent = date.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
      time.title = date.toLocaleString()
      bar.append(time)
    }
    function action(glyph, label, handler) {
      const button = node('button')
      button.type = 'button'; button.title = label; button.setAttribute('aria-label',label)
      button.innerHTML = icon(glyph,16); button.onclick = () => handler(button)
      bar.append(button)
    }
    if (m.text) action('copy','复制消息',async button => {
      try {
        await copyText(m.text,button); button.innerHTML = icon('check',16)
        button.title = '已复制'; button.setAttribute('aria-label','已复制')
      } catch (error) { button.title = error.message; button.setAttribute('aria-label',error.message) }
      setTimeout(() => { button.innerHTML = icon('copy',16); button.title = '复制消息'; button.setAttribute('aria-label','复制消息') },1500)
    })
    if (edit) action('pencil','编辑消息',edit)
    return bar
  }
  // The grid, approval area and lazy-loaded media can finish layout after the history arrives.
  function followLatest(stream, content) {
    let following = true, lastTop = 0
    function rememberPosition() {
      if (!stream.clientHeight) return
      const top = stream.scrollTop
      if (stream.scrollHeight - top - stream.clientHeight <= 2) following = true
      else if (top < lastTop) following = false
      lastTop = top
    }
    function align() {
      if (!stream.clientHeight || !following || content.querySelector('.edit-form')) return
      rememberPosition()
      if (following) {
        stream.scrollTop = stream.scrollHeight
        lastTop = stream.scrollTop
      }
    }
    stream.addEventListener('scroll',rememberPosition,{passive:true})
    stream.addEventListener('click',e => {
      if (e.target.closest('.work summary')) following = false
    })
    const observer = new ResizeObserver(align)
    observer.observe(stream); observer.observe(content)
    return () => observer.disconnect()
  }
  function transcript(content, loadDetails, richText, userImage, submitEdit) {
    const rows = new Map()
    let editor
    function startEdit(host,m,card) {
      editor?.remove()
      const form = node('form','edit-form')
      editor = form
      form.dataset.messageId = m.id
      const editId = crypto.randomUUID(), expectedTail = card.turns.at(-1)?.id
      const input = node('textarea')
      input.setAttribute('aria-label','编辑消息'); input.value = m.editText ?? m.text
      const buttons = node('div','buttons'), cancel = node('button','','取消'), send = node('button','primary','发送')
      cancel.type = 'button'; send.type = 'submit'; buttons.append(cancel,send)
      const notice = node('small','',expectedTail === m.turnId ? '发送后将重新生成这一轮回复。' : '发送后将从这一轮重新生成，后续对话将被替换。')
      form.append(input,notice,buttons); host.append(form)
      function update() {
        input.rows = 1; input.rows = Math.min(14,Math.max(2,Math.ceil(input.scrollHeight / (parseFloat(getComputedStyle(input).lineHeight) || 22))))
        send.disabled = !input.value.trim() || input.value === (m.editText ?? m.text)
      }
      function close() {
        form.remove(); editor = null
        host.querySelector('[aria-label="编辑消息"]')?.focus()
      }
      cancel.onclick = close; input.oninput = update
      input.onkeydown = e => {
        if (e.isComposing || e.keyCode === 229) return
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!cancel.disabled) close() }
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!send.disabled) form.requestSubmit() }
      }
      form.onsubmit = async e => {
        e.preventDefault()
        if (send.disabled) return
        send.disabled = cancel.disabled = input.disabled = true
        try {
          await submitEdit({turnId:m.turnId,messageId:m.id,text:input.value,editId,expectedTail})
          close()
        } catch (error) {
          notice.textContent = error.message
          cancel.disabled = input.disabled = false; update(); input.focus()
        }
      }
      update(); input.focus(); input.setSelectionRange(input.value.length,input.value.length)
    }
    function paintSteps(container, items) {
      const nodes = items.map(m => {
        const row = node('div','step')
        if (m.label || m.role === 'tool') row.append(node('div','step-label',m.label || '执行步骤'))
        row.append(m.role === 'tool' ? node('pre','toolbody',m.text) : richText(m.text))
        if (m.output) row.append(node('pre','step-output',m.output))
        return row
      })
      container.replaceChildren(...nodes)
    }
    function create(id) {
      const el = node('section','turn')
      const users = node('div'), replies = node('div'), first = node('div','message-unit agent-unit'), surface = node('div','response-surface'), work = node('details','work')
      const summary = node('summary'), caption = node('span'), steps = node('div','steps')
      const chev = node('span','chev'); chev.innerHTML = icon('chevron',12)
      summary.append(caption,chev); work.append(summary,steps); surface.append(work); first.append(surface); replies.append(first); el.append(users,replies); content.append(el)
      const row = {el,users,replies,first,surface,work,caption,steps,meta:null,signature:'',live:null,loaded:null}
      row.paint = () => {
        if (!work.open) { steps.replaceChildren(); return }
        paintSteps(steps,row.loaded || row.items || [])
        if (!steps.childElementCount) steps.textContent = row.live ? '等待执行更新…' : '本轮没有记录执行步骤。'
        if (row.meta?.error) steps.append(node('p','',row.meta.error))
      }
      work.ontoggle = async () => {
        if (!work.open || row.meta?.detailsLoaded || row.live || row.loaded) { row.paint(); return }
        if (!row.meta || row.loading) return
        row.loading = true; steps.textContent = '读取执行记录…'
        try {
          row.loaded = splitTurn(await loadDetails(id),false).steps
          row.paint()
        } catch(e) { steps.textContent = e.message }
        finally { row.loading = false }
      }
      return row
    }
    return card => {
      const meta = new Map((card.turns || []).map(t => [t.id,t]))
      const grouped = new Map()
      let fallbackId = 'history'
      for (const m of card.messages) {
        if (!m.turnId && m.role === 'user') fallbackId = m.id || 'turn-' + grouped.size
        const id = m.turnId || fallbackId
        if (!grouped.has(id)) grouped.set(id,[])
        grouped.get(id).push(m)
        if (!meta.has(id)) meta.set(id,{id,detailsLoaded:true})
      }
      for (const [id,r] of rows) if (!meta.has(id)) { r.el.remove(); rows.delete(id) }
      for (const [id,t] of meta) {
        if (!rows.has(id)) rows.set(id,create(id))
        const r = rows.get(id), items = grouped.get(id) || []
        const live = id === card.turn || t.status === 'inProgress'
        const canEdit = !card.turn && card.status.type !== 'active'
        const signature = JSON.stringify([items,t,live,canEdit,card.turns.at(-1)?.id])
        if (signature === r.signature) continue
        r.signature = signature; r.meta = t
        const {users,finals,steps} = splitTurn(items,live)
        r.users.replaceChildren(...users.map(m => {
          const bubble = node('div','user'); bubble.append(richText(m.text,true))
          if (m.images?.length) {
            const strip = node('div','media-strip')
            for (const img of m.images) strip.append(userImage(m.id,img))
            bubble.append(strip)
          }
          bubble.setAttribute('aria-label','你的发言')
          const unit = node('div','message-unit user-unit')
          unit.append(bubble,toolbar(m,m.timeMs ?? (m === users[0] ? t.startedAt*1000 || undefined : undefined),
            canEdit && m === users[0] ? () => startEdit(unit,m,card) : null))
          if (editor?.dataset.messageId === m.id) unit.append(editor)
          return unit
        }))
        r.surface.querySelector('.agent')?.remove()
        r.first.querySelector('.message-tools')?.remove()
        while (r.replies.lastElementChild !== r.first) r.replies.lastElementChild.remove()
        for (const [index,m] of finals.entries()) {
          const unit = index === 0 ? r.first : node('div','message-unit agent-unit')
          const surface = index === 0 ? r.surface : node('div','response-surface')
          const answer = node('div','agent')
          answer.append(richText(m.text)); surface.append(answer)
          if (index > 0) { unit.append(surface); r.replies.append(unit) }
          unit.append(toolbar(m,m.timeMs ?? (t.completedAt*1000 || undefined)))
        }
        const time = elapsed(t.durationMs)
        let summary = time ? '用时 ' + time : '执行详情'
        if (t.status === 'interrupted') summary = '已中断' + (time ? ' · ' + summary : '')
        if (t.status === 'failed') summary = '执行失败' + (time ? ' · ' + summary : '')
        const latest = live ? steps.at(-1) : null
        const detail = latest && (latest.label || latest.text || '').trim().split('\n')[0]
        r.caption.textContent = live ? ['正在执行',detail].filter(Boolean).join(' · ') : summary
        r.work.querySelector('summary').title = r.caption.textContent
        r.work.classList.toggle('live',live)
        r.work.hidden = !live && !steps.length && !time && t.detailsLoaded && !t.error && !['failed','interrupted'].includes(t.status)
        if (r.live !== live) { r.work.open = false; r.live = live }
        r.items = steps
        if (!r.loading && r.work.open) r.paint()
      }
      if (editor && !content.contains(editor)) content.append(editor)
    }
  }
  function activity(c) {
    if (!c) return 'idle'
    if (c.awaitingApproval || c.approvals?.length || c.status.activeFlags?.includes('waitingOnApproval')) return 'pending'
    if (c.status.activeFlags?.includes('waitingOnUserInput')) return 'waiting'
    if (c.status.type === 'active') return 'running'
    return c.status.type === 'systemError' ? 'error' : 'idle'
  }
  function selectionKey(api) { return api.demo ? 'codex-wall.demo.selection.v1' : 'codex-wall.selection.v1' }
  function readSelection(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key))
      if (Array.isArray(value?.ids) && Array.isArray(value.visibleIds)) return value
    } catch {}
  }
  function resolveSelection(catalog,previous) {
    const available = new Set(catalog.map(c => c.id))
    let ids, visibleIds
    if (previous) {
      ids = [...new Set(previous.ids)].filter(id => available.has(id))
      if (ids.length > 8) {
        const priority = new Set([...previous.visibleIds.filter(id => ids.includes(id)).slice(0,4), ...ids])
        const keep = new Set([...priority].slice(0,8))
        ids = ids.filter(id => keep.has(id))
      }
      visibleIds = [...new Set(previous.visibleIds)].filter(id => ids.includes(id)).slice(0,4)
    } else {
      ids = catalog.filter(c => ['active','idle'].includes(c.status.type)).slice(0,4).map(c => c.id)
      if (!ids.length) ids = catalog.slice(0,1).map(c => c.id)
      visibleIds = ids.slice(0,4)
    }
    return {ids,visibleIds}
  }
  function mount(root, api) {
    const shadow = root.shadowRoot || root.attachShadow({mode:'open'})
    const frame = document.createElement('section')
    frame.className = 'wall'
    frame.innerHTML = `<div class="page"><header class="headline">
      <button class="choose" aria-label="绑定会话" aria-haspopup="dialog" title="绑定会话"><span class="brand">${icon('windows',16)}</span>Codex 会话窗 ${icon('chevron',10)}</button>
      <nav class="tabbar" aria-label="已绑定会话"></nav>
      <div class="stats"><i class="dot"></i><span class="connection">正在连接</span><span class="counts"></span></div>
      <div class="actions"><button class="bare backgrounds" aria-label="背景图库" title="背景图库">${icon('picture')}</button><button class="bare close" aria-label="关闭会话窗" title="关闭会话窗">${icon('close')}</button></div></header>
      <p role="status" class="alert" hidden></p><div class="grid"></div><p class="empty" hidden></p>
      <dialog aria-label="绑定会话"><header>绑定会话<button class="bare cancel" aria-label="关闭">${icon('close',14)}</button></header><small>最多绑定 8 个会话，同时显示 4 个。<span class="quota"></span></small><div class="rows"></div></dialog>
      <dialog class="background-dialog" aria-label="背景图库"><header>背景图库<small></small><button class="bare gallery-close" aria-label="关闭图库">${icon('close',14)}</button></header><div class="gallery"></div><p>拖动图片调整背景顺序，最多 8 张。</p><label class="wash-control">背景遮罩<input type="range" min="0" max="100" step="1"><output></output></label><button class="add-background">添加图片</button><input type="file" multiple hidden><p role="status"></p></dialog>
      <dialog class="preview-dialog" aria-labelledby="preview-title"><header><button class="bare preview-back" aria-label="返回上一份预览">‹</button><strong id="preview-title"></strong><button class="bare preview-close" aria-label="关闭预览">${icon('close')}</button></header><div class="preview-body"></div></dialog></div>`
    const style = document.createElement('style')
    style.textContent = css
    shadow.replaceChildren(style,frame)
    const $ = s => frame.querySelector(s)
    const theme = matchMedia('(prefers-color-scheme: dark)')
    const palette = () => frame.classList.toggle('dark', document.body.hasAttribute('data-ds-dark-theme') || (api.demo ? theme.matches : getComputedStyle(document.documentElement).colorScheme === 'dark'))
    const observer = new MutationObserver(palette)
    observer.observe(document.body, {attributes:true,attributeFilter:['data-ds-dark-theme']})
    theme.addEventListener('change',palette); palette()
    const views = new Map()
    const drafts = new Map()
    let catalog = [], revision = -1, focused = null, dead = false, changing = false, connected = false, timer, ticks = 0
    const storageKey = selectionKey(api)
    const saved = readSelection(storageKey)
    let selection = {ids:[], visibleIds:[]}
    const gallery = backgroundLibrary($('.background-dialog'),storageKey+'.backgrounds',() => gallery.apply(selection.ids,views))
    $('.backgrounds').onclick = gallery.open
    let confirmed = selection
    let initialized = false
    let live = new Map()
    let nextColor = 0
    const shortcuts = new Map()
    const pickerRows = new Map()
    const dlg = $('dialog')
    const preview = makePreview($('.preview-dialog'))
    const alert = text => { $('.alert').textContent = text; $('.alert').hidden = !text }
    function connection(on) {
      connected = on
      $('.connection').textContent = api.demo ? '交互预览' : on ? 'Desktop 已连接' : '正在重连 Desktop'
      $('.stats .dot').classList.toggle('on',on)
      $('.choose').disabled = !on
      tabs()
      for (const view of views.values()) view.controls()
    }
    const stripes = ['#6485b3','#56a28b','#a08bc0','#bd916a']
    const statusText = {idle:'空闲', running:'运行中', pending:'待审批', waiting:'等待输入', error:'异常'}
    function reflectSelection() {
      for (const [id,b] of shortcuts) {
        b.setAttribute('aria-pressed', String(selection.visibleIds.includes(id)))
        b.disabled = !connected
        b.nextElementSibling.disabled = !connected
      }
      $('.quota').textContent = '已绑定 ' + selection.ids.length + ' / 8'
      for (const [id,input] of pickerRows) {
        input.checked = selection.ids.includes(id)
        input.disabled = !connected || (!input.checked && selection.ids.length >= 8)
      }
    }
    function tabs() {
      let running = 0
      for (const [id,b] of shortcuts) {
        if (!selection.ids.includes(id)) { b.parentElement.remove(); shortcuts.delete(id) }
      }
      for (const id of selection.ids) {
        const thread = live.get(id) || catalog.find(c => c.id === id)
        if (!thread) continue
        if (!shortcuts.has(id)) {
          const slot = node('div','tab-slot'), b = node('button','tab'), unbind = node('button','unbind')
          slot.dataset.threadId = b.dataset.threadId = id
          b.setAttribute('aria-keyshortcuts','Alt+ArrowLeft Alt+ArrowRight')
          b.append(node('span','bar'),node('span'))
          b.style.setProperty('--stripe',stripes[nextColor++ % stripes.length])
          b.onclick = () => toggleVisible(id)
          unbind.type = 'button'; unbind.innerHTML = icon('close',12)
          unbind.onclick = () => {
            const neighbor = slot.nextElementSibling || slot.previousElementSibling
            const hadFocus = shadow.activeElement === unbind
            toggleBound(id)
            if (hadFocus) (neighbor?.querySelector('.tab') || $('.choose')).focus()
          }
          slot.append(b,unbind); $('.tabbar').append(slot); shortcuts.set(id,b)
        }
        const b = shortcuts.get(id), state = activity(thread)
        const bar = $('.tabbar'), at = bar.children[selection.ids.indexOf(id)]
        if (at !== b.parentElement) bar.insertBefore(b.parentElement,at || null)
        if (state === 'running') running++
        b.dataset.activity = state
        b.lastChild.textContent = thread.title
        b.title = thread.title + ' · ' + statusText[state] + ' · 拖动排序'
        b.setAttribute('aria-label',b.title)
        const unbind = b.nextElementSibling
        unbind.title = '取消绑定：'+thread.title
        unbind.setAttribute('aria-label',unbind.title)
      }
      $('.headline').classList.toggle('working', connected && running > 0)
      $('.counts').textContent = selection.visibleIds.length + ' 显示 / ' + selection.ids.length + ' 绑定'
      $('.stats').title = $('.connection').textContent + ' · ' + running + ' 个运行中'
      reflectSelection()
    }
    enableReorder(frame,{handles:'.tab,.cardhead',targets:'.tab-slot,.card',keyboard:'.tab',key:'threadId'},() => selection.ids,(id,dest) => {
      if (!connected) return
      const order = [...selection.ids], from = order.indexOf(id), to = order.indexOf(dest)
      if (from < 0 || to < 0 || from === to) return
      order.splice(from,1); order.splice(to,0,id)
      changeSelection(order,selection.visibleIds,true)
    })
    function toggleBound(id) {
      if (!connected) return
      const {ids,visibleIds} = selection
      if (ids.includes(id)) {
        changeSelection(ids.filter(key => key !== id),visibleIds.filter(key => key !== id))
      } else if (ids.length < 8) {
        changeSelection([...ids,id],visibleIds.length < 4 ? [...visibleIds,id] : visibleIds)
      }
    }
    function toggleVisible(id) {
      if (!connected) return
      const {ids,visibleIds} = selection
      const next = visibleIds.includes(id) ? visibleIds.filter(key => key !== id) : [...visibleIds.slice(-3),id]
      changeSelection(ids,next)
    }
    async function changeSelection(ids,visibleIds,preserveFocus = false) {
      selection = {ids,visibleIds}
      if (focused && !preserveFocus) focus(focused)
      tabs()
      if (changing) return
      changing = true; connection(true)
      try {
        let requested
        do {
          requested = selection
          const data = await api.call('watch',requested)
          if (dead) return
          confirmed = requested
          if (requested === selection) render(data)
        } while (requested !== selection)
        try { localStorage.setItem(storageKey,JSON.stringify(confirmed)) } catch {}
        alert('')
      } catch(e) {
        selection = confirmed
        alert(e.message); connection(false); tabs()
      } finally { changing = false; connection(connected) }
    }
    function focus(id) {
      focused = focused === id ? null : id
      $('.grid').classList.toggle('focus',!!focused)
      for (const [key,v] of views) {
        v.el.hidden = !!focused && focused !== key
        v.zoom.title = focused === key ? '恢复多屏' : '放大此会话'
        v.zoom.setAttribute('aria-label',v.zoom.title)
      }
      tabs()
    }
    function makeCard(id) {
      const el = document.createElement('article')
      el.className = 'card'
      el.innerHTML = `<header class="cardhead"><div class="titles"><h2></h2><div class="project">${icon('folder',12)}<span></span></div></div><span class="state"><i class="dot"></i><span class="model-info"><span class="model-fast" aria-label="Fast" role="img" hidden>${icon('fast',13)}</span><span class="model-name"></span> <span class="model-effort"></span></span></span><button class="bare zoom" title="放大此会话" aria-label="放大此会话">${icon('expand',13)}</button></header>
      <div class="stream" tabindex="0" aria-label="最近消息"><div class="transcript-body"></div></div><div class="requests"></div><div class="carderror" role="status"></div><form class="composer"><div class="image-drafts"></div><button type="button" class="bare attach" title="添加图片" aria-label="添加图片">${icon('attach',16)}</button><input class="image-picker" type="file" multiple hidden><textarea rows="1" maxlength="12000" aria-label="发送给此会话的指令" placeholder="发送后续指令…"></textarea><button class="send" aria-label="发送指令" title="发送指令">${icon('up',16)}</button></form>`
      const q = s => el.querySelector(s), input = q('textarea'), stream = q('.stream')
      el.dataset.threadId = id; q('.cardhead').dataset.threadId = id
      q('.cardhead').title = '拖动调整会话顺序'
      const content = q('.transcript-body')
      const view = { el, zoom:q('.zoom'), state:null, dispose:followLatest(stream,content) }
      const fileURL = path => api.fileURL ? api.fileURL(id,path) : new URL(path,document.baseURI).href
      const openPreview = item => preview(item,fileURL,api.readDemo)
      const updateTranscript = transcript(content,turnId => api.call('details',{threadId:id,turnId}),
        (text,user) => markdown(text,fileURL,openPreview,user), (message,attachment) => {
          const img = new Image()
          img.alt = attachment.name; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'
          img.src = attachment.url || api.attachmentURL(id,message,attachment.index)
          return imageLink(img,img.src,openPreview)
        }, async payload => {
          if (!connected || changing || busy) throw Error('会话尚未就绪')
          busy = true; view.controls()
          try { await api.call('edit',{threadId:id,...payload}) }
          finally { busy = false; view.controls() }
        })
      let busy = false, requests = ''
      const draft = drafts.get(id) || {text:'',images:[],reading:false}
      drafts.set(id,draft)
      input.value = draft.text
      const paintImages = composeImages(q('.composer'),draft,() => {
        const current = views.get(id)
        if (current && current !== view) current.syncDraft()
        view.controls()
      }, message => { (views.get(id)?.el || el).querySelector('.carderror').textContent = message })
      view.syncDraft = () => { input.value = draft.text; paintImages(); view.controls() }
      view.controls = () => {
        q('.send').disabled = !connected || busy || changing || draft.reading || (!input.value.trim() && !draft.images.length)
        q('.attach').disabled = busy || draft.reading
        for (const btn of q('.requests').querySelectorAll('button')) btn.disabled = !connected || busy || changing
      }
      input.oninput = () => { draft.text = input.value; view.controls() }
      async function act(method, payload) {
        if (busy || !connected) return false
        busy = true; view.controls(); q('.carderror').textContent = ''
        try { await api.call(method,{threadId:id,...payload}); return true }
        catch(e) { q('.carderror').textContent = e.message; return false }
        finally { busy = false; view.controls() }
      }
      q('.composer').onsubmit = async e => {
        e.preventDefault()
        if (q('.send').disabled) return
        const text = input.value
        const sent = [...draft.images]
        if (await act('send',{text,images:sent.map(i=>i.url),turn:view.state.turn})) {
          if (draft.text === text) draft.text = ''
          draft.images = draft.images.filter(i=>!sent.includes(i))
          views.get(id)?.syncDraft()
        }
      }
      input.onkeydown = e => {
        if(e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); q('.composer').requestSubmit() }
      }
      view.zoom.onclick = () => focus(id)
      view.update = c => {
        view.state = c
        q('h2').textContent = c.title; q('h2').title = c.title
        q('.project span').textContent = c.cwd.split(/[\\/]/).filter(Boolean).at(-1) || c.cwd
        q('.project').title = [c.cwd,c.model].filter(Boolean).join(' · ')
        const state = activity(c), pending = state === 'pending'
        el.dataset.activity = state
        q('.state').className = 'state ' + state
        const effort = {none:'无',minimal:'极低',low:'低',medium:'中',high:'高',xhigh:'极高',max:'最高',ultra:'Ultra'}[c.effort] || c.effort || '默认'
        const fast = c.tier === 'fast' || c.tier === 'priority'
        q('.model-fast').hidden = !fast
        q('.model-name').textContent = c.modelLabel || c.model || '模型未知'
        q('.model-effort').textContent = c.model === 'auto' ? '' : effort
        q('.state').title = [statusText[state],q('.model-name').textContent,q('.model-effort').textContent,fast && 'Fast'].filter(Boolean).join(' · ')
        q('.state .dot').setAttribute('aria-label',statusText[state])
        q('.state .dot').setAttribute('role','img')
        updateTranscript(c)
        const signature = JSON.stringify([c.approvals,!!pending])
        if (signature !== requests) {
          requests = signature; q('.requests').replaceChildren()
          for (const a of c.approvals) {
            const box = document.createElement('section'); box.className = 'approval'
            box.innerHTML = '<strong>' + icon('shield',14) + '<span></span></strong><div class="details"></div><div class="buttons"></div>'
            box.querySelector('strong span').textContent = a.kind + '请求'
            box.querySelector('.details').textContent = [a.command,a.reason,a.scope].filter(Boolean).join('\n')
            if (!a.decisions.length) box.querySelector('.buttons').textContent = '请前往 Codex Desktop 处理'
            for (const d of [...a.decisions].reverse()) {
              const btn = document.createElement('button')
              btn.textContent = {accept:'允许一次',decline:'拒绝',cancel:'取消本轮'}[d]
              if (d === 'accept') btn.className = 'primary'
              btn.onclick = async () => {
                if (await act('decide',{token:a.token,decision:d})) box.remove()
              }
              box.querySelector('.buttons').append(btn)
            }
            q('.requests').append(box)
          }
          if (pending && !c.approvals.length) q('.requests').textContent = '请在 Codex Desktop 中查看此审批'
        }
        view.controls()
      }
      $('.grid').append(el)
      return view
    }
    function render(data) {
      if (dead || !data.cards || (connected && data.revision < revision)) return
      revision = data.revision
      live = new Map((data.bound || data.cards).map(c => [c.id,c]))
      const cards = new Map(data.cards.map(c => [c.id,c]))
      const ids = selection.ids.filter(id=>cards.has(id))
      for (const [id,v] of views) if (!ids.includes(id)) { v.dispose(); v.el.remove(); views.delete(id) }
      if (!ids.includes(focused)) { focused = null; $('.grid').classList.remove('focus') }
      for (const id of ids) {
        const c = cards.get(id)
        if (!views.has(c.id)) views.set(c.id,makeCard(c.id))
        const v = views.get(c.id); v.update(c); v.el.hidden = !!focused && focused !== c.id
        const grid = $('.grid'), at = grid.children[ids.indexOf(id)]
        if (at !== v.el) grid.insertBefore(v.el,at || null)
        v.zoom.hidden = ids.length === 1
      }
      tabs()
      for (const [id,v] of views) v.el.style.setProperty('--stripe',shortcuts.get(id)?.style.getPropertyValue('--stripe') || stripes[0])
      gallery.apply(selection.ids,views)
      $('.grid').dataset.count = String(ids.length)
      $('.grid').style.setProperty('--cols',String(Math.max(1,ids.length)))
      $('.empty').hidden = ids.length > 0
      $('.empty').textContent = selection.ids.length ? '点击上方的会话标签开始阅读。' : catalog.length ? '从左上角绑定要查看的会话。' : '当前账号还没有 Codex Desktop 会话。'
    }
    async function tick() {
      try {
        if (!connected || ticks++ % 20 === 0) {
          catalog = await api.call('list',{connect:!connected, bound:initialized ? selection.ids : saved?.ids})
        }
        if (dead) return
        if (!connected) {
          selection = resolveSelection(catalog,initialized ? selection : saved)
          const data = await api.call('watch',selection)
          if (dead) return
          confirmed = selection; initialized = true
          connection(true); revision = -1; render(data); alert('')
        } else if (!changing) {
          const data = await api.call('snapshot',{revision})
          if (!changing) render(data)
        }
      } catch(e) { if (!dead) { connection(false); alert(e.message) } }
      if (!dead) timer = setTimeout(tick,connected ? 650 : 3000)
    }
    $('.choose').onclick = () => {
      const rows = $('.rows')
      rows.replaceChildren(); pickerRows.clear()
      for (const c of catalog) {
        const label = node('label','row')
        const box = node('input'); box.type = 'checkbox'; box.value = c.id
        pickerRows.set(c.id,box)
        box.onchange = () => toggleBound(c.id)
        label.append(box,node('span','',c.title)); rows.append(label)
      }
      if (!catalog.length) rows.textContent = '暂无可选会话'
      reflectSelection(); dlg.showModal()
    }
    $('.cancel').onclick = () => dlg.close()
    $('.close').onclick = api.back
    $('.choose').disabled = true; tick()
    return () => { dead = true; clearTimeout(timer); for (const view of views.values()) view.dispose(); preview.dispose(); gallery.close(); api.close?.(); observer.disconnect(); theme.removeEventListener('change',palette); shadow.replaceChildren() }
  }

  function launcher(root, makeApi, initiallyOpen = false) {
    const shadow = root.shadowRoot || root.attachShadow({mode:'open'})
    const style = node('style')
    style.textContent = `
      :host{pointer-events:none}.rail{position:fixed;z-index:120;inset:58px 14px auto auto;pointer-events:auto}
      .launch{display:grid;place-items:center;width:30px;height:30px;border:1px solid #0000000c;border-radius:8px;padding:0;background:#e9e9ea;color:#393b40;cursor:pointer;box-shadow:0 1px 3px #00000012}
      .launch svg{width:18px;height:18px}.launch:hover{background:#dcdcde}.launch:focus-visible{outline:2px solid #4681c6;outline-offset:2px}
      @media(prefers-color-scheme:dark){.launch{color:#e5e5e7;background:#343538;border-color:#ffffff14}.launch:hover{background:#414246}}
      .hint{position:absolute;right:0;top:100%;width:max-content;max-width:min(270px,calc(100vw - 30px));padding-top:6px;cursor:default;font:12px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#27292d}
      .hint-body{background:#fff;border:1px solid #dedfe1;border-radius:10px;padding:10px 12px;box-shadow:0 4px 18px #1418211a}
      .hint strong{font-size:13px}.hint p{margin:2px 0 7px;color:#676c72}.hint-status{display:flex;align-items:center;gap:6px;font-variant-numeric:tabular-nums}
      .hint-status::before{content:"";flex:none;width:6px;height:6px;border-radius:50%;background:#90959e}
      .hint-status[data-state=online]::before{background:#2c8765}.hint-status[data-state=pending]::before{background:#c4811d}.hint-status[data-state=offline]::before{background:#b7514a}
      @media(prefers-color-scheme:dark){.hint{color:#eee}.hint-body{background:#2b2c2f;border-color:#46484d}.hint p{color:#b0b3b9}}
      .window{box-sizing:border-box;position:fixed;inset:0;margin:0;width:100%;height:100dvh;max-width:none;max-height:none;padding:0;overflow:hidden;border:0;border-radius:0;background:#fff;pointer-events:auto}
      .window:focus{outline:none}.rail[hidden]{display:none}.surface{height:100%}
      @media(max-width:650px){.rail{right:8px}}
      @media(prefers-color-scheme:dark){.window{background:#202226}}
    `
    const rail = node('div','rail')
    rail.setAttribute('role','toolbar'); rail.setAttribute('aria-label','Codex 悬浮栏')
    const button = node('button','launch')
    button.type = 'button'; button.setAttribute('aria-label','打开 Codex 会话窗')
    button.setAttribute('aria-haspopup','dialog'); button.setAttribute('aria-expanded','false')
    button.innerHTML = launcherArt
    const hint = node('div','hint')
    hint.id = 'launcher-hint'; hint.hidden = true; hint.setAttribute('role','tooltip')
    hint.innerHTML = '<div class="hint-body"><strong>Codex 会话窗</strong><p>并排查看会话，发送消息或处理审批。</p><div class="hint-status" role="status"></div></div>'
    button.setAttribute('aria-describedby',hint.id)
    rail.append(button,hint)
    const win = node('dialog','window'), surface = node('div','surface')
    win.setAttribute('aria-label','Codex 会话窗'); win.append(surface)
    shadow.replaceChildren(style,rail,win)
    let release, hoverSession, refreshTimer
    const status = hint.querySelector('.hint-status')
    async function refreshHint(session) {
      session.loading = true
      try {
        session.api ??= makeApi()
        const saved = readSelection(selectionKey(session.api))
        const rows = await session.api.call('list',{connect:true,bound:saved?.ids})
        if (session !== hoverSession) return
        const {ids} = resolveSelection(rows,saved)
        const states = rows.filter(c => ids.includes(c.id)).map(activity)
        const pending = states.filter(s => s === 'pending').length
        const running = states.filter(s => s === 'running').length
        status.dataset.state = pending ? 'pending' : 'online'
        status.textContent = [session.api.demo ? '交互预览' : '已连接','已绑定 '+ids.length,'运行中 '+running,'待审批 '+pending].join(' · ')
      } catch {
        if (session === hoverSession) { status.dataset.state = 'offline'; status.textContent = '未连接到 Codex' }
      } finally {
        session.loading = false
        if (hoverSession === session) refreshTimer = setTimeout(() => refreshHint(session),4000)
        else session.api?.close?.()
      }
    }
    function showHint() {
      if (win.open || rail.hidden || hoverSession) return
      hint.hidden = false; status.dataset.state = 'loading'; status.textContent = '正在获取会话状态…'
      hoverSession = {loading:false}
      refreshTimer = setTimeout(() => refreshHint(hoverSession),120)
    }
    function hideHint() {
      clearTimeout(refreshTimer); hint.hidden = true
      if (hoverSession && !hoverSession.loading) hoverSession.api?.close?.()
      hoverSession = null
    }
    rail.onpointerenter = e => { if (e.pointerType !== 'touch') showHint() }
    rail.onpointerleave = () => { if (!button.matches(':focus-visible')) hideHint() }
    button.onfocus = () => { if (button.matches(':focus-visible')) showHint() }
    button.onblur = () => { if (!rail.matches(':hover')) hideHint() }
    const dismissHint = e => { if (e.key === 'Escape' && !hint.hidden) hideHint() }
    document.addEventListener('keydown',dismissHint)
    function closeWindow() { if (win.open) win.close() }
    win.onclose = () => { release?.(); release = null; rail.hidden = false; button.setAttribute('aria-expanded','false'); button.focus() }
    button.onclick = () => {
      if (win.open) return
      hideHint(); win.showModal(); rail.hidden = true
      button.setAttribute('aria-expanded','true')
      release = mount(surface,{...makeApi(),back:closeWindow})
    }
    if (initiallyOpen) button.click()
    return () => { document.removeEventListener('keydown',dismissHint); hideHint(); win.onclose = null; closeWindow(); release?.(); shadow.replaceChildren() }
  }

  if (!window.__ModuleLoader__) { window.mountCodexLauncher = launcher; return }
  window.__ModuleLoader__.load({id:'dsh-codex-plugin',factory: require => {
    const React = require('react')
    function createApi() {
      const board = crypto.randomUUID()
      const call = async (op,payload) => {
        const response = await fetch(new URL('api/codex-wall',document.baseURI),{
          method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({...payload,board,op})
        })
        if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('dsh 连接不可用（HTTP ' + response.status + '）')
        const result = await response.json()
        if (!response.ok) throw new Error(result.error)
        return result.value
      }
      const fileURL = (threadId,path) => {
        const url = new URL('api/codex-wall-file',document.baseURI)
        url.search = new URLSearchParams({board,threadId,path})
        return url.href
      }
      const attachmentURL = (threadId,message,index) => {
        const url = new URL('api/codex-wall-file',document.baseURI)
        url.search = new URLSearchParams({board,threadId,message,index})
        return url.href
      }
      return {call,fileURL,attachmentURL,close:()=>{call('close',{}).catch(()=>{})}}
    }
    function FloatingToolbar() {
      const ref = React.useRef(null)
      React.useEffect(() => launcher(ref.current,createApi),[])
      return React.createElement('div',{ref,'data-codex-floating-toolbar':''})
    }
    return {inject:['slots'],apply(ctx) {
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({name:'shell.overlay',id:'codex-multiscreen'},FloatingToolbar))
    }}
  }})
})()
