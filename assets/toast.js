/* ============================================================
   MNEMO · 提示条（toast）+ 复制            2026-09-16
   ------------------------------------------------------------
   为什么有这个文件：
     老师提的一条：网页上**长得像按钮的东西，点下去都得有反应**。
     档案页上有一批按钮（Call Mei / Show me where / Print the plan /
     Add someone …）原来是裸 <button>，一个事件都没绑，点了石沉大海。

     它们里面大部分**不该跳页**。点「Call Mei」想要的是号码，不是换一屏。
     所以统一成一条从底部升起的提示条。

   ⚠️ 口径（整个项目一以贯之）：**只说这一下会发生什么，不说"已经做了"**。
       · 能真做的就真做：复制号码是真的复制，Print 是真的调打印，
         「Show me where」是真的翻到平面那一屏。做完照实说。
       · 背后确实没有东西的（发提醒、加人），提示写的是**这个功能是什么**，
         不写"已发送""已添加" —— 一句假的回执比一个没反应的按钮糟得多。

   用法：
     MNEMO_TOAST.show('一句话')            弹一条，4 秒自动收
     MNEMO_TOAST.copy('07700 900 118')     复制，返回 Promise<boolean>
     MNEMO_TOAST.wire({extra:fn})          接管页面上所有 [data-act]

   页面上已经有提示条的（home-file.html 就有一个），给它加
   data-mnemo-toast / data-mnemo-toast-msg 两个属性即可复用，
   本文件就不再自己造一个，样式跟着那一页走。
   ============================================================ */
(function (root, doc) {
'use strict';

var CSS = [
  '#mnemo-toast{position:fixed;left:50%;bottom:30px;z-index:9999;',
  '  transform:translateX(-50%) translateY(10px);opacity:0;pointer-events:none;',
  '  max-width:min(560px,calc(100vw - 40px));',
  '  background:#1A1917;color:#FBF8F2;border-radius:999px;',
  /* 字号用 rem 不用 px —— 本人版的「放大字号」改的是根字号，
     写死 px 的话整页都长了，只有这条提示条没跟着长。 */
  '  padding:.75rem 1.4rem;font:inherit;font-size:.85rem;line-height:1.4;text-align:center;',
  '  box-shadow:0 10px 30px rgba(0,0,0,.26);',
  '  transition:opacity .28s ease, transform .28s cubic-bezier(.22,.7,.3,1)}',
  '#mnemo-toast.is-on{opacity:1;transform:translateX(-50%) translateY(0);pointer-events:auto}',
  /* 手机（≤760）：上面那种 left:50% + translateX(-50%) 的居中，在 fixed 定位下
     盒子最多只能有「屏幕宽的一半」那么宽 —— 393 的手机上只有 196px，
     一句话被挤成五六行的窄黑块。电脑上一半也有 500 多，比上限 560 差不多，看不出来。
     窄屏改成左右各留 16px 撑开、margin:auto 居中；多行时圆角改小，不再是胶囊形。
     （2026-09-22。home-file-resident.html 里另有一份同样的覆盖，还管着给底栏让位，留着不冲突。） */
  '@media (max-width:760px){',
  '  #mnemo-toast{left:16px;right:16px;width:auto;margin-inline:auto;transform:translateY(10px);border-radius:22px}',
  '  #mnemo-toast.is-on{transform:translateY(0)}',
  '}',
  '@media (prefers-reduced-motion:reduce){#mnemo-toast{transition-duration:.01s}}'
].join('');

var box = null, msg = null, timer = 0;

function mount(){
  if (box) return;
  /* 页面自带的优先 —— 那一页的提示条长什么样是设计过的，别另起一个 */
  var own = doc.querySelector('[data-mnemo-toast]');
  if (own){
    box = own;
    msg = own.querySelector('[data-mnemo-toast-msg]') || own;
    return;
  }
  var st = doc.createElement('style'); st.textContent = CSS;
  doc.head.appendChild(st);
  box = doc.createElement('div');
  box.id = 'mnemo-toast';
  box.setAttribute('role','status');       /* 读屏会念出来，不用抢焦点 */
  box.setAttribute('aria-live','polite');
  msg = box;
  doc.body.appendChild(box);
}

function show(text, ms){
  mount();
  if (!box) return;
  msg.textContent = text;
  box.classList.add('is-on');
  clearTimeout(timer);
  timer = setTimeout(function(){ box.classList.remove('is-on'); }, ms || 4200);
}

/* 复制。navigator.clipboard 只在 https / localhost 下才有；
   直接双击打开 html 文件（file://）时没有，所以留了老办法兜底。
   复制不成功要**照实说**，不能照样弹一句"已复制"。 */
function copy(text){
  var t = String(text == null ? '' : text);
  if (root.navigator && root.navigator.clipboard && root.isSecureContext){
    return root.navigator.clipboard.writeText(t).then(function(){ return true; },
                                                      function(){ return legacy(t); });
  }
  return Promise.resolve(legacy(t));
}
function legacy(t){
  try{
    var ta = doc.createElement('textarea');
    ta.value = t;
    ta.setAttribute('readonly','');
    ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    doc.body.appendChild(ta);
    ta.select();
    var ok = doc.execCommand('copy');
    doc.body.removeChild(ta);
    return !!ok;
  }catch(e){ return false; }
}

/* ── 把页面上所有 [data-act] 接起来 ────────────────────────
   委托在 document 上，所以后加进 DOM 的按钮也能用。
     data-act="say"    data-say="…"                 只弹一句
     data-act="copy"   data-copy="…"                复制 + 弹一句
                       data-ok / data-fail          成功 / 失败时的前半句
     data-act="print"                               调浏览器打印
   页面自己的动作（比如翻到某一屏）走 opts.extra(act, btn)，
   返回 true 表示"我处理了"。 */
function wire(opts){
  opts = opts || {};
  doc.addEventListener('click', function(e){
    var btn = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!btn) return;
    var act = btn.getAttribute('data-act') || '';
    if (opts.extra && opts.extra(act, btn) === true) return;

    if (act === 'say'){
      show(btn.getAttribute('data-say') || '');
      return;
    }
    if (act === 'copy'){
      var v = btn.getAttribute('data-copy') || '';
      copy(v).then(function(ok){
        show((ok ? (btn.getAttribute('data-ok')   || 'Copied')
                 : (btn.getAttribute('data-fail') || 'Here it is')) + '  —  ' + v);
      });
      return;
    }
    if (act === 'print'){
      show(btn.getAttribute('data-say') || 'Opening your printer.', 2200);
      setTimeout(function(){ try{ root.print(); }catch(err){} }, 260);
      return;
    }
  });
}

root.MNEMO_TOAST = { show:show, copy:copy, wire:wire };

})(window, document);
