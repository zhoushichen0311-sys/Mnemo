/* ═══════════════════════════════════════════════════════════════
   MNEMO · 医护人员版 · 共用内核
   ───────────────────────────────────────────────────────────────
   五个步骤页共用这一份。每页只写自己那一屏的三件事：
     render()    把 data 画到屏幕上
     parse(t)    这一屏认哪些话
     apply(p)    把解析结果写进 data，返回「填了哪几项」的标签

   其余全在这里：舞台缩放、档案状态、语言跟随、搭话识别、
   本地话术、对话坞、LLM 分流、进度计算、下一步跳转。

   对话逻辑和 flow.html（家属版）、flow-resident.html（本人版）
   是同一套：CHATTER 前置 → route() 判意图 → 失败退回本地正则。
   改这里之前先看那两个文件，别让三版走岔。

   依赖：assets/llm.js（可选。没有 / 断网 / 超时都能跑）
   ═══════════════════════════════════════════════════════════════ */
(function (global) {
'use strict';

var $ = function (id) { return document.getElementById(id); };

/* ── 档案：整条流程共用一个对象，存在 sessionStorage ─────── */
var KEY = 'mnemo:carer';

/* 14 格 = 这份客户记录的分母。
   第 3–5 步做的是「方案」和「签字」，不是「记录」，所以不进这里 ——
   否则同一份档案在不同屏上会显示不同的完成度。

   转介来源 / 案号 / 同意范围三格已删（这一版不收这些）。
   换上了行动 / 视力 / 记忆 —— 它们才是整套方案真正的起点：
   门洞该 850 还是不作要求，是由「她坐不坐轮椅」决定的，
   在这之前那些尺寸只是写死的常数。 */
var COUNTED = ['carerName','carerRole','carerTeam',
               'name','age','gender','lives','home',
               'mobility','vision','memory',
               'homeStd','doorway','corridor'];

function blank(){
  return {
    carerName:'', carerRole:'', carerTeam:'',
    name:'', age:'', gender:'', lives:'', home:'',
    /* 身体与认知。存的是逗号分隔的短标签串（多选），
       不存数组 —— load() 按 String() 还原，数组会被拍成 "a,b" 变不回来。 */
    mobility:'', vision:'', memory:'',
    /* 这三组的「你是怎么知道的」。比尺寸更需要 ——
       "我看她走了一趟" 和 "她女儿说的" 分量完全不同。
       值域同下：measured(=你亲眼所见) | told | records */
    bMobility:'', bVision:'', bMemory:'',
    homeStd:'', doorway:'', corridor:'', bath:'', turning:'',
    /* 每个实测值「你是怎么知道的」。医护版的命根子 ——
       "我拿卷尺量的" 和 "她女儿说的" 是两种证据等级，
       后面复核、申请经费，分量完全不同。
       值域：measured | told | records（空 = 还没填这个数） */
    bDoorway:'', bCorridor:'', bBath:'', bTurning:'',
    /* 第 3 步起：这些是「方案」和「签字」，不是「记录」，
       所以不进 COUNTED —— 档案完成度不该被方案选择拉高。
       undone / otFlags 存的是逗号分隔的 id，不存数组 ——
       load() 是按 String() 还原的，数组会被拍成 "a,b" 再也变不回去。 */
    layout:'', undone:'', otFlags:'',
    /* 第 5 步：签字之前这份记录不算数，所以状态要全流程可见 */
    declared:'', signedAt:'', signedBy:''
  };
}

var C = {
  KEY: KEY,
  COUNTED: COUNTED,
  data: blank(),
  lang: 'en',
  $: $
};

C.load = function(){
  try{
    var s = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (s && typeof s === 'object'){
      for (var k in C.data) if (s[k] != null) C.data[k] = String(s[k]);
    }
  }catch(e){}
  return C.data;
};
C.save = function(){
  try{ sessionStorage.setItem(KEY, JSON.stringify(C.data)); }catch(e){}
};

/* 逗号串 ↔ 数组，两边都收在这里，别在页面里各写一遍。
   （必须放在 var C = {...} 之后 —— 写在 blank() 后面的时候
     C 还是 undefined，整个内核直接不加载。） */
/* 依据来源：三个档，全流程共用一套说法 */
C.BASIS = ['measured', 'told', 'records'];
/* kind='seen' 用在行动/视力/记忆那三组 —— 这些是看出来的不是量出来的，
   同一个 measured 在那边要读作「你亲眼看到的」。值本身不变，只换说法。 */
C.basisLabel = function(v, zh, kind){   /* zh 形参已废弃，中文版移除后不再读 */
  if (kind === 'seen')
    return ({ measured:'OBSERVED', told:'TOLD', records:'FROM RECORDS' })[v] || '—';
  return ({ measured:'MEASURED', told:'TOLD', records:'FROM RECORDS' })[v] || '—';
};
/* home file 的 Visit history 那一列用的是完整说法 */
C.basisLong = function(v, zh){          /* 同上，zh 已废弃 */
  return ({ measured:'Measured', told:'Reported', records:'From records' })[v] || 'Not stated';
};
C.basisNext = function(v){
  var i = C.BASIS.indexOf(v);
  return C.BASIS[(i + 1) % C.BASIS.length];
};

/* ── 输入校验 ───────────────────────────────────────────────
   inputmode="numeric" 只是手机键盘提示，一个字符都不拦。
   实测：门洞能填 abc / -500 / 12.5 / 999999，全都原样进了卡片，
   999999 还会得出「Doorway 999999 ≥ the 850 she needs」——
   一个六米宽的门。这些值会一路流进第 4 步的改动清单和签字记录。 */
C.LIMITS = {
  doorway:  { min:300,  max:2500, unit:'mm' },
  corridor: { min:400,  max:4000, unit:'mm' },
  bath:     { min:600,  max:6000, unit:'mm' },
  age:      { min:1,    max:120,  unit:'' }
};
/* 返回 { ok, v, why }。v 是清洗后的值（整数字符串），不合法时 v 是 ''。 */
C.checkNum = function(kind, raw){
  var lim = C.LIMITS[kind];
  var t = String(raw == null ? '' : raw).trim();
  if (!t) return { ok:true, v:'', why:'' };            /* 空着不算错 */
  if (!lim) return { ok:true, v:t, why:'' };
  if (!/^\d+$/.test(t))
    return { ok:false, v:'', why: 'numbers only'};
  var n = parseInt(t, 10);
  if (n < lim.min) return { ok:false, v:'', why: ('too small — at least ' + lim.min + lim.unit)};
  if (n > lim.max) return { ok:false, v:'', why: ('too large — at most ' + lim.max + lim.unit)};
  return { ok:true, v:String(n), why:'' };
};
/* 文本字段的长度上限。医护版原来一个都没有 ——
   姓名贴进 4400 字，右卡标题会长到 2556px，直接溢出舞台。 */
C.MAXLEN = { carerName:40, carerRole:40, carerTeam:60, name:40, gender:24, lives:40, home:40 };

C.listGet = function(k){
  return String(C.data[k] || '').split(',').filter(Boolean);
};
C.listHas = function(k, id){ return C.listGet(k).indexOf(id) > -1; };
C.listToggle = function(k, id){
  var a = C.listGet(k), i = a.indexOf(id);
  if (i > -1) a.splice(i, 1); else a.push(id);
  C.data[k] = a.join(',');
  return i < 0;                    /* true = 刚加上 */
};

/* ── 舞台：1440×960 等比缩放，任何窗口都和 Figma 一致 ──────
   ⚠️ 手机上这条"按宽度缩放"会自己反过来咬人：
   393 的屏幕算出来 k = 0.27，页面里 12px 的正文变成 3.3px ——
   整张图还在，但一个字都读不了，等于没有内容。

   这几页（医护版五步 + 医护版档案）是 1440 的定尺画布，
   坐标逐个对着 Figma 抄的，重排成手机版等于重画整页，不在这次范围里。
   这里做的是退一步的处理：给缩放一个**可读下限**，
   低于下限就不再缩，改成横向可以拖。
   宁可一次看半张能读的，也不要一整张读不了的。
   竖着排的页面（家属版 / 本人版）不走这条路径，它们是真的响应式。 */
C.MIN_K   = 0.72;   /* 12px → 8.6px。再低就不用看了 */
C.PAN_MAX = 1024;   /* 只有窄过这个宽度才启用下限。
                       1024 是最窄的常见笔记本宽度，它自己算出来的 k 是 0.711，
                       正好压在下限边上 —— 不设这道闸，电脑端窗口一拖窄就会
                       跳进"横向拖动"模式，那不是这次要动的东西。 */

/* ── 2026-09-22：窄屏改成一栏重排，只上下滑 ────────────────────
   页面 <head> 里 link 了 assets/carer-mobile.css（并在 <html> 上标
   data-mobile="stack"）的，窄于 1024 时整页按那份样式重排成一栏，
   这里就**不再缩放**：把缩放留下的行内样式全部清掉，交给 CSS。
   ≥1024 的电脑端走下面原来那段，一行没改。
   没标 data-mobile 的页面（万一有）照旧走老的「缩到 0.72 + 左右拖」。 */
C.STACK_MAX = 1023;
C.stacked = function(){
  return document.documentElement.getAttribute('data-mobile') === 'stack' &&
         window.matchMedia('(max-width:' + C.STACK_MAX + 'px)').matches;
};

/* 文案里「左边的表单」在一栏排版里是「上面的表单」 */
C.where = function(){ return C.stacked() ? 'above' : 'on the left'; };

C.fitStage = function(){
  var stage = $('stage'), wrap = $('stagewrap');
  if (!stage || !wrap) return;

  function fit(){
    if (C.stacked()){
      stage.style.removeProperty('--k');
      stage.style.transformOrigin = ''; stage.style.marginRight = '';
      wrap.style.justifyContent = ''; wrap.style.overflowX = ''; wrap.style.height = '';
      hint(false);
      return;
    }
    var raw = Math.min(1, window.innerWidth / 1440);
    var panned = raw < C.MIN_K && window.innerWidth < C.PAN_MAX;
    var k = panned ? C.MIN_K : raw;
    stage.style.setProperty('--k', k);

    if (panned){
      /* transform 不改变布局尺寸：舞台的布局宽度永远是 1440，
         缩放只影响画出来的样子。所以要做两件事，少一件都会出问题：
           1) 原点从 top center 改成 top left —— 否则画面被居中画在
              1440 的框里，左边先滚过一大片空白才看得到内容；
           2) 用负的 margin-right 把布局宽度收回到 1440*k ——
              否则滚动条按 1440 算，右边会多出一截滚不到东西的空白。 */
      stage.style.transformOrigin = 'top left';
      stage.style.marginRight = (1440 * k - 1440) + 'px';
      wrap.style.justifyContent = 'flex-start';
      wrap.style.overflowX = 'auto';
      wrap.style.webkitOverflowScrolling = 'touch';
    } else {
      stage.style.transformOrigin = '';
      stage.style.marginRight = '';
      wrap.style.justifyContent = '';
      wrap.style.overflowX = '';
    }

    /* 高度要现读，不能写死 960 —— 档案页是 1480，
       写死的话下半截会被 stagewrap 的 overflow:hidden 裁掉。 */
    var h = stage.offsetHeight || 960;
    wrap.style.height = (h * k) + 'px';

    hint(panned);
  }

  /* 一行提示，只在被拖模式下出现。插在 stagewrap 前面，
     六个页面共用这一段，不用去每个 html 里加标签。 */
  function hint(on){
    var el = document.getElementById('panhint');
    if (!on){ if (el) el.remove(); return; }
    if (el) return;
    el = document.createElement('p');
    el.id = 'panhint';
    el.textContent = 'This clinical view is laid out for a wide screen — drag sideways to see the rest.';
    el.style.cssText = 'margin:0;padding:10px 16px;font-size:11.5px;line-height:1.45;'
      + 'color:#736E66;background:rgba(255,255,255,.62);border-bottom:1px solid #DEDAD2;';
    wrap.parentNode.insertBefore(el, wrap);
  }

  fit();
  window.addEventListener('resize', fit);
};

/* ── 小工具 ─────────────────────────────────────────────── */
C.setV = function(el, val, blankText){
  if (!el) return;
  var empty = !val;
  el.textContent = empty ? (blankText || '—') : val;
  el.classList.toggle('blank', empty);
};
C.flash = function(el){
  if (!el) return;
  el.classList.remove('justfilled');
  void el.offsetWidth;              /* 强制重排，动画才会重放 */
  el.classList.add('justfilled');
};
/* 签没签字是全流程可见的状态：第 5 步签完，回头看第 1 步也是签了的 */
C.signedTag = function(){
  return C.data.signedAt ? 'SIGNED ' + C.data.signedAt : 'NOTHING SIGNED YET';
};
/* ── 签完字就锁 ─────────────────────────────────────────────
   第 5 步的签名块上写着「Cannot be edited after signing.
   Corrections are added as new entries.」——但实测签完字回到第 2 步，
   门洞照样能改，改完签字状态还是 SIGNED，也没留下任何痕迹。
   一份声称可追溯的记录，这一条塌了，BASIS、签字、访视记录就全是虚的。

   「追加更正」那套流程这一版没有，所以这里做的是**只读**：
   签完之后前面几步一律不能改，并且在屏幕上说清楚为什么、以及
   要改该怎么办 —— 不假装有一个不存在的更正入口。 */
C.locked = function(){ return !!C.data.signedAt; };

C.applyLock = function(){
  if (!C.locked()) return false;
  /* 所有录入控件一律禁用：输入框、chips、依据来源按钮 */
  Array.prototype.forEach.call(
    document.querySelectorAll('.panel input, .panel button, .mchip input, .chip, .bs'),
    function(el){
      /* 「下一步」和步骤条上的链接不属于录入，别一起锁死，
         否则签完字连自己的记录都翻不了。 */
      if (el.id === 'next' || el.closest('.steps') || el.closest('.dock')) return;
      el.disabled = true;
      if (el.tagName === 'INPUT') el.readOnly = true;
      el.setAttribute('aria-disabled', 'true');
    });

  C.stamp();                       /* 顶栏刷成 SIGNED，别停在 NOTHING SIGNED YET */
  if (!$('lockbar')){
    var bar = document.createElement('p');
    bar.id = 'lockbar';
    bar.className = 'lockbar mono';
    bar.textContent = 'Signed at ' + C.data.signedAt + ' by ' + (C.data.signedBy || 'you') + ' — this record can no longer be edited. A correction would need a new entry, which this version does not do yet.';
    var panel = document.querySelector('.panel');
    if (panel && panel.parentNode) panel.parentNode.insertBefore(bar, panel);
  }
  return true;
};

C.stamp = function(){
  var el = $('saved'); if (!el) return;
  /* 锁上之后不再刷新「自动保存于几点」—— 那会让人以为记录还在变。
     但签字状态必须照常显示，否则顶栏会停在 NOTHING SIGNED YET。 */
  if (C.locked()){ el.innerHTML = C.signedTag(); return; }
  var d = new Date();
  el.innerHTML = 'AUTOSAVED ' + String(d.getHours()).padStart(2,'0') + ':' +
                 String(d.getMinutes()).padStart(2,'0') +
                 ' &nbsp;·&nbsp; ' + C.signedTag();
};
C.filled = function(){
  var n = 0;
  for (var i = 0; i < COUNTED.length; i++) if (C.data[COUNTED[i]]) n++;
  return n;
};
C.pct = function(){ return Math.round(C.filled() / COUNTED.length * 100); };

/* 进度条 + 百分比 + 右上角状态，三处同一个来源，永远对得上 */
C.paintProgress = function(){
  var n = C.filled(), pct = C.pct();
  var p = $('pct'), bar = $('bar'), st = $('state');
  if (p)   p.innerHTML = 'FILE ' + pct + '% COMPLETE &nbsp;·&nbsp; ' + C.signedTag();
  if (bar) bar.style.width = pct + '%';
  if (st)  st.textContent = C.data.signedAt ? 'SIGNED' : (n ? 'NOT SAVED YET' : 'NOTHING SAVED YET');
  return n;
};

/* 右卡上半部分（姓名 + 一行概要）每一屏都一样 */
C.paintHead = function(){
  var who = $('fWho'), meta = $('fMeta');
  if (who){
    who.textContent = C.data.name || 'No name yet';
    who.classList.toggle('empty', !C.data.name);
  }
  if (meta){
    var bits = [];
    if (C.data.age)  bits.push(C.data.age);
    if (C.data.home) bits.push(C.data.home);
    if (C.data.lives && /alone/i.test(C.data.lives)) bits.push('lives alone');
    meta.textContent = bits.length ? bits.join('  ·  ') : 'Nothing recorded';
  }
};

/* ── 语言 / 搭话识别 / 本地话术 ─────────────────────────────
   这三样和 flow.html、flow-resident.html 是同一套。 */
C.CN_CHAR = /[一-龥]/;
/* 以前这里会「发现用户打中文就把界面切成中文」，并返回 true 让调用方重画。
   中文版整体移除后不再切语言，永远返回 false —— 调用点保留着，
   万一以后要再做多语言，钩子还在。 */
C.noteLang = function(){ return false; };

/* 「hi」「谢谢」这类不是答案，也不是问题 */
C.CHATTER = /^\s*(?:hi|hello|hey|yo|good\s*(?:morning|afternoon|evening)|thanks?(?:\s*you)?|thx|cheers|bye|goodbye|see\s*you|ok(?:ay)?|sure|你好呀?|您好|哈喽|哈啰|嗨|在吗|在么|谢谢你?|谢了|多谢|感谢|再见|拜拜|好的?|行|嗯+)[\s!！,，.。?？~]*$/i;

C.isQuestion = function(v){
  return /[?？]\s*$/.test(v)
      || /^\s*(what|why|how|can|could|is|are|do|does|did|will|would|should|who|whose|when|where|which|any|tell me)\b/i.test(v)
      || /(吗|呢|怎么|为什么|能不能|可不可以|多少|哪个|哪里|是不是)/.test(v);
};

/* 接口没起来的时候也得像句人话。每页可以覆盖尾句。 */
/* 正则里的中文关键词有意保留：用户照样可以用中文打招呼、道谢，
   MNEMO 听得懂，只是一律用英文回答。 */
C.localReply = function(v, tail){
  if (/^\s*(?:hi|hello|hey|你好|您好|哈喽|嗨|在吗)/i.test(v))
    return 'Hello. I am MNEMO — you record what you see, I work out what the room still needs, to measured rules.';
  if (/^\s*(?:thanks?|thx|谢谢|谢了|多谢|感谢)/i.test(v))
    return 'You are welcome.';
  if (/^\s*(?:bye|再见|拜拜)/i.test(v))
    return 'Of course — what you have entered stays on this page. Nothing is filed until you sign.';
  if (tail) return tail(false);
  return 'Noted. Ask me anything concrete — corridor widths, whether a chair turns, or how many millimetres a doorway is short.';
};

/* ── LLM ────────────────────────────────────────────────────
   判定和另外两版逐字一致：MOCK 模式下照样走假应答器。 */
C.hasLLM = function(){ return !!(global.MNEMO_LLM && global.MNEMO_LLM.chat); };

/* 接口再快也等一下，太快弹出来反而假 */
C.floor = function(p, ms){
  var t0 = Date.now();
  return Promise.resolve(p).catch(function(){ return null; }).then(function(v){
    var wait = Math.max(0, (ms || 420) - (Date.now() - t0));
    return new Promise(function(r){ setTimeout(function(){ r(v); }, wait); });
  });
};

/* ── 她怎么动、怎么看、怎么记 ─────────────────────────────
   权重和选项**完全沿用家属版**（flow.html 第 3051–3113 行），
   不另立一套 —— 同一个人由家属填还是由医护填，结论必须一样。
   每组：[短标签(存这个), 完整说法(给人看), 权重]
   多选，取最严重的一项算权重。 */
C.NEEDS = {
  mobility: [
    ['Unaided',          'Walks unaided',         0],
    ['Cane',             'Uses a cane',           2],
    ['Frame',            'Uses a walking frame',  3],
    ['Unsteady turning', 'Unsteady when turning', 3],
    ['No steps',         'Cannot manage steps',   4],
    ['Wheelchair',       'Wheelchair indoors',    5]
  ],
  vision: [
    ['No issues',      'No issues',              0],
    ['Small print',    'Cannot read small print',2],
    ['Poor at night',  'Weaker at night',        3],
    ['Needs contrast', 'Needs strong contrast',  3],
    ['Very limited',   'Very limited vision',    5]
  ],
  memory: [
    ['No issues',      'No issues',                 0],
    ['Misplaces',      'Forgets where things are',  3],
    ['Colour cues',    'Needs colour cues',         4],
    ['Lost at night',  'Gets disoriented at night', 5]
  ]
};

C.needShort = function(short){ return short; };

C.needWeight = function(kind){
  var picked = C.listGet(kind), rows = C.NEEDS[kind], max = -1;
  for (var i = 0; i < picked.length; i++)
    for (var j = 0; j < rows.length; j++)
      if (rows[j][0] === picked[i] && rows[j][2] > max) max = rows[j][2];
  return max;                     /* -1 = 这一组还没填 */
};
C.needLong = function(kind, short){
  var rows = C.NEEDS[kind];
  for (var i = 0; i < rows.length; i++)
    if (rows[i][0] === short)
      return rows[i][1];
  return short;
};

/* ── 从「她的状况」推出「房子要满足什么」 ────────────────────
   ⚠️ 这里只写家属版已经明确说过的口径，一个数字都不自己发明：
     行动 ≥5（室内轮椅）→ 门洞净宽 850、走廊 1200、每间 Ø1500 转圈
     行动 ≥2（拐杖起）  → 走廊 1200 + 转弯处有可扶的东西
     行动 0–1           → 走廊仍按 1200（"现在不花钱，以后有用"）
   家属版没说过「拐杖需要多宽的门」，所以 door 在这些档位是 null，
   界面上显示「没有硬性要求」，而不是编一个数出来。

   视力和记忆不产生尺寸，只产生做法上的要求（对比度、颜色、夜间动线），
   这也是家属版的原话，照搬过来。

   返回 null = 行动那一组还没填 = 还推不出任何东西。 */
C.needs = function(){
  var mob = C.needWeight('mobility');
  if (mob < 0) return null;
  var vis = C.needWeight('vision'), mem = C.needWeight('memory');

  var n = { mob:mob, vis:vis, mem:mem,
            door:null, corridor:1200, turning:false, grab:false, extras:[] };

  if (mob >= 5){ n.door = 850; n.turning = true; n.why = 'wheelchair indoors'; }
  else if (mob >= 2){ n.grab = true; n.why = 'walks with support'; }
  else { n.why = 'walks unaided'; }

  if (vis >= 5) n.extras.push({ k:'vision', t:'Strong contrast floor-to-wall, night route lit the whole way' });
  else if (vis >= 2) n.extras.push({ k:'vision', t:'Raise the contrast between floor and wall' });

  if (mem >= 4) n.extras.push({ k:'memory', t:'One function one colour, same colour in every room' });
  else if (mem >= 2) n.extras.push({ k:'memory', t:'Keep the colour system consistent room to room' });

  if (n.grab) n.extras.push({ k:'mobility', t:'Something to hold on to at every turn' });
  return n;
};

/* ── 走哪一套现状平面 ─────────────────────────────────────
   家属版（flow.html 的 s2Track）按「三项里哪一项最严重」决定
   用哪一套现状平面 —— 视力主导和行动主导看到的不是同一批房子，
   面积、房间数、开间都不一样，说明文字也不一样。

   医护版第 2 步之前把 thumb-mobility-A/B/C 直接内联在页面里，
   等于不管她是什么状况都给同一批平面 —— 视力和记忆那两组白填了。

   并列时家属版会追问一句「哪个最要紧」；这一版没有那一问，
   所以按 mobility → vision → memory 的固定顺序取第一个，
   并且把「并列」这件事透出来（C.trackTied），界面上说明白。
   三项全 0 或全没填 → mobility，和家属版一样当通用起点。 */
C.track = function(){
  var w = { mobility:C.needWeight('mobility'), vision:C.needWeight('vision'), memory:C.needWeight('memory') };
  var order = ['mobility','vision','memory'];
  var top = Math.max(w.mobility, w.vision, w.memory);
  if (top <= 0) return 'mobility';
  for (var i = 0; i < order.length; i++) if (w[order[i]] === top) return order[i];
  return 'mobility';
};
C.trackTied = function(){
  var w = { mobility:C.needWeight('mobility'), vision:C.needWeight('vision'), memory:C.needWeight('memory') };
  var order = ['mobility','vision','memory'];
  var top = Math.max(w.mobility, w.vision, w.memory);
  if (top <= 0) return [];
  var t = order.filter(function(k){ return w[k] === top; });
  return t.length > 1 ? t : [];
};
C.TRACK_LABEL = {
  mobility:{ en:'mobility' },
  vision:  { en:'eyesight' },
  memory:  { en:'memory'   }
};

/* 三套现状户型的数据，逐字照搬 flow.html 的 PLAN_SETS。
   ⚠️ 这里**没有门洞尺寸** —— 家属版本来就没有这个字段。
   第 2 步原先卡片上写的 "Doorways 760 / 800 / 850 mm" 是我编的，
   已经去掉了。房型卡只说这套图真有的东西：面积、房间数、开间。 */
C.PLAN_SETS = {
  mobility: [
    { k:'A', area:'56.25 m²', rooms:'2 rooms', dim:'7.5 × 7.5 m' },
    { k:'B', area:'43.2 m²',  rooms:'2 rooms', dim:'9.6 × 4.5 m' },
    { k:'C', area:'36 m²',    rooms:'4 rooms', dim:'L-shaped'    }
  ],
  vision: [
    { k:'A', area:'47.0 m²', rooms:'4 rooms', dim:'5.1 × 10.8 m' },
    { k:'B', area:'46.1 m²', rooms:'4 rooms', dim:'4.8 × 9.6 m'  },
    { k:'C', area:'43.6 m²', rooms:'4 rooms', dim:'6.6 × 6.6 m'  }
  ],
  memory: [
    { k:'A', area:'44.6 m²', rooms:'2 rooms', dim:'4.8 × 9.3 m' },
    { k:'B', area:'40.2 m²', rooms:'3 rooms', dim:'7.2 × 6.6 m' },
    { k:'C', area:'40.9 m²', rooms:'2 rooms', dim:'8.6 × 6.0 m' }
  ]
};
C.planType = function(k){
  var set = C.PLAN_SETS[C.track()] || C.PLAN_SETS.mobility;
  for (var i = 0; i < set.length; i++) if (set[i].k === k) return set[i];
  return set[0];
};

/* 一句话说清「她需要什么」，给第 1 步的即时回显用 */
C.needsLine = function(){
  var n = C.needs();
  if (!n) return 'No mobility recorded yet — nothing to derive';
  var b = [];
  if (n.door)    b.push((n.door + ' MM DOORS'));
  b.push((n.corridor + ' MM CORRIDORS'));
  if (n.turning) b.push('Ø1500 EVERY ROOM');
  if (n.grab)    b.push('GRAB RAILS AT TURNS');
  return b.join('  ·  ');
};

/* 右卡那一行只有 300px，完整版会被截成「Ø150…」。
   数字本身就够认了，单位和名词省掉。 */
C.needsShort = function(){
  var n = C.needs();
  if (!n) return '';
  var b = [];
  if (n.door) b.push(n.door);
  b.push(n.corridor);
  if (n.turning) b.push('Ø1500');
  if (n.grab)    b.push('rails');
  /* 只剩走廊一项的时候，光一个「1200」看不出是什么，补上词 */
  if (b.length === 1) return b[0] + ' mm corridors';
  return b.join(' · ');
};

/* ── 人的信息：姓名 / 年龄 / 性别 / 同住 / 房型 ──────────────
   任何一屏都可能听到这些（医护随时会补一句），所以放内核。
   规矩：宁可少认，不能认错 —— 这是一份要签字的记录。 */
var ROLES = [
  ['occupational therapist','Occupational therapist'],
  ['physiotherapist',       'Physiotherapist'],
  ['district nurse',        'District nurse'],
  ['social worker',         'Social worker'],
  ['support worker',        'Support worker'],
  ['care assistant',        'Care assistant'],
  ['care worker',           'Care worker'],
  ['key worker',            'Key worker'],
  ['nurse',                 'Nurse'],
  ['carer',                 'Carer']
];
var ZH_ROLE = { '护工':'Care worker', '护理员':'Care worker', '照护员':'Care worker',
                '护士':'Nurse', '社区护士':'District nurse', '社工':'Social worker',
                '职业治疗师':'Occupational therapist', '物理治疗师':'Physiotherapist' };

C.parsePerson = function(text){
  var t = ' ' + text.toLowerCase().replace(/[’]/g,"'").replace(/\s+/g,' ') + ' ';
  var p = {}, m, i;

  /* 我是谁。触发词不分大小写，名字必须大写开头 —— 免得把
     "i'm visiting" 里的 visiting 当成名字。
     is / 's 都做成可省：口语里「My name Chen He」很常见，
     之前写死 "my name is" 的时候这句整个抓不到名字。 */
  m = text.match(/\b(?:[Ii]['’]m(?:\s+called)?|[Ii] am|[Cc]all me|[Mm]y name(?:['’]s|\s+is)?|[Tt]his is)\s+([A-Z][a-zA-Z'’-]+(?:\s+[A-Z][a-zA-Z'’-]+){0,2})/);
  if (m) p.carerName = m[1].replace(/\s+/g,' ');

  for (i = 0; i < ROLES.length; i++)
    if (t.indexOf(' ' + ROLES[i][0]) > -1){ p.carerRole = ROLES[i][1]; break; }

  m = text.match(/\b(?:at|with|from)\s+((?:[A-Z][\w'’-]*\s+){0,3}(?:Team|Trust|Service|Services|Council|Centre|Center))\b/);
  if (m) p.carerTeam = m[1].trim();

  /* 触发词要大小写都认（句首的 It's / This is），但**名字本身**必须大写开头 ——
     所以不能整条加 'i'，那会让 [A-Z] 失效（nameFrom 就是这么抓出「is Ying」的）。
     只好把触发词逐个写成大小写兼容。 */
  m = text.match(/\b(?:[Vv]isiting|[Ss]eeing|[Ii]t(?:'s|’s| is) for|[Tt]his is for|[Cc]lient is|[Pp]atient is|[Rr]esident is)\s+((?:Mrs?|Ms|Dr)?\.?\s*[A-Z][a-zA-Z'’-]+(?:\s+[A-Z][a-zA-Z'’-]+){0,2})/);
  if (m) p.name = m[1].trim();

  /* 「Mr Chen is 68」「Doris Bell, 91」—— 句首就是人名，后面直接跟年龄，
     没有任何触发词。只在**这句话没有第一人称**时才敢用，
     否则「I'm Alice, 40」会把医护自己填成被访者。 */
  if (!p.name && !/\b(?:I|I['’]m|my|me|we|our)\b/i.test(text) && !/我|咱/.test(text)){
    m = text.match(/^\s*((?:Mrs?|Ms|Dr)?\.?\s*[A-Z][a-zA-Z'’-]+(?:\s+[A-Z][a-zA-Z'’-]+)?)\s*(?:,\s*|\s+is\s+)(\d{2,3})\b/);
    if (m && parseInt(m[2],10) >= 40 && parseInt(m[2],10) <= 120) p.name = m[1].trim();
  }

  /* 年龄：全局扫，挑第一个像年龄的数。
     否则「case 4417」里的 441 会被当成年龄拦在前面。 */
  var re = /\b(\d{2,3})\b/g;
  while ((m = re.exec(text)) !== null){
    var n = parseInt(m[1], 10);
    if (n >= 40 && n <= 120){ p.age = String(n); break; }
  }

  /* ── 代词是在说谁？───────────────────────────────────────
     gender / lives 记的是**被访老人**的，不是医护自己的。
     直接在整句上找代词会串档：
       「My name Chen He and I'm a care worker.」
        → Chen He 里的 He 被当成代词，老人的性别被填成 He / him
       「我叫陈赫，是护工」→ 同样的问题

     所以先按标点和 and 把句子切成分句，把**医护自述**的那几段丢掉：
     含第一人称（I / my / we / 我）而又没提到被访者姓名的分句，
     说的都是医护自己，不该参与判断。剩下的再挖掉人名本身，
     免得 Chen He / Sarah Hu / Shea 这类姓名被读成代词。
     宁可少认不能认错 —— 这是一份要签字的记录。 */
  var FIRST_PERSON = /\b(?:I|I['’]m|I['’]ve|my|me|we|our)\b/i;
  var probe = text
    /* 切分符里不能放 with / 和 —— 「lives with his wife」会被从中间切开，
       同住对象就抓不到了。团队名是在原文上抓的，不靠这里切。 */
    .split(/[,.;，。；、]|\band\b/i)
    .filter(function(seg){
      if (!FIRST_PERSON.test(seg) && !/我|咱/.test(seg)) return true;   /* 不是自述，留 */
      return !!(p.name && seg.indexOf(p.name) > -1);                    /* 自述但点名了被访者，也留 */
    })
    /* 用「，」而不是空格拼回去：否定词判断（NEG_CN）是看命中位置**之前**
       那几个字，空格会把原来的分句边界抹掉，于是
       「…晚上看不清，老忘事」里的「不」跨句否定掉了「忘事」，
       记忆那一组整个丢失。留着标点，否定词就跨不过去。 */
    .join('，');

  [p.carerName, p.name].forEach(function(n){
    if (!n) return;
    probe = probe.replace(new RegExp(n.replace(/[.*+?^${}()|[\]\\-]/g,'\\$&'), 'gi'), ' ');
  });

  if (/\b(she|her|hers)\b/i.test(probe)) p.gender = 'She / her';
  else if (/\b(he|him|his)\b/i.test(probe)) p.gender = 'He / him';
  else if (/\bthey\b/i.test(probe) && /\bthem\b/i.test(probe)) p.gender = 'They / them';

  if (/\b(lives? alone|on her own|on his own|by herself|by himself|nobody else|no one else)\b/i.test(probe))
    p.lives = 'Alone';
  else if (/\bwith (?:her|his) (husband|wife|son|daughter|partner|family|sister|brother)\b/i.test(probe))
    p.lives = RegExp.$1.charAt(0).toUpperCase() + RegExp.$1.slice(1);

  if (/ground[- ]floor flat/i.test(text))      p.home = 'Ground-floor flat';
  else if (/first[- ]floor flat/i.test(text))  p.home = 'First-floor flat';
  else if (/\bbungalow\b/i.test(text))         p.home = 'Bungalow';
  else if (/\bterraced?\b/i.test(text))        p.home = 'Terraced house';
  else if (/\bsheltered\b/i.test(text))        p.home = 'Sheltered housing';
  else if (/\bcare home\b/i.test(text))        p.home = 'Care home';

  /* ── 行动 / 视力 / 记忆 ────────────────────────────────
     用 assets/nlu-rules.js 里那份共享关键词表（原本是家属版的 PICK_RULES）。
     这里原先自己写过一套简版，结果同样的话两版认得不一样 ——
     实测家属版认得「zimmer」「gets around fine」「走路没问题」，
     简版全不认。同一个人由谁来填，结论必须一样。

     C.NEEDS 每行的第二列（完整说法）正好就是规则表的 key，
     所以映射是天然的：认出完整说法 → 存回短标签。

     一样走 probe：「I use a wheelchair」说的是医护自己。 */
  if (global.MNEMO_NLU){
    Object.keys(C.NEEDS).forEach(function(kind){
      var rows = C.NEEDS[kind];
      var labels = rows.map(function(r){ return r[1]; });
      var picked = global.MNEMO_NLU.pickLocal(probe, labels);
      if (!picked.length) return;
      var shorts = picked.map(function(lab){
        for (var i = 0; i < rows.length; i++) if (rows[i][1] === lab) return rows[i][0];
        return null;
      }).filter(Boolean);
      if (shorts.length) p[kind] = shorts.join(',');
    });
  }

  /* ── 中文。另外两版的本地兜底也是双语的 ───────────────── */
  if (C.CN_CHAR.test(text)){
    var zhMe, zhMeRe = /我(?:叫|是|姓)\s*([一-龥]{2,5})/g;
    /* 「我是护工，我叫李敏」一句话说两件事，要每个都过一遍 */
    while ((zhMe = zhMeRe.exec(text)) !== null){
      var w = zhMe[1];
      if (ZH_ROLE[w]){ if (!p.carerRole) p.carerRole = ZH_ROLE[w]; }
      else if (!p.carerName) p.carerName = w;
    }

    /* 上面那个循环要求每一段都以「我」开头，所以「我叫陈赫，是护工」
       的后半句抓不到 —— 中间那个「我」被省掉了。角色单独再扫一遍：
       职业名词本身就够明确，不需要靠「我」来限定。 */
    if (!p.carerRole){
      var zhKeys = Object.keys(ZH_ROLE).sort(function(a,b){ return b.length - a.length; });
      for (i = 0; i < zhKeys.length; i++){
        if (text.indexOf(zhKeys[i]) > -1){ p.carerRole = ZH_ROLE[zhKeys[i]]; break; }
      }
    }
    if (!p.name){
      m = text.match(/(?:叫做|名叫|名字是|她叫|他叫)\s*([一-龥]{2,4})/);
      if (m) p.name = m[1];
      else {
        m = text.match(/(?:^|[，。、\s])(?:她|他)?姓([一-龥])/);
        if (m && !/^我/.test(text)) p.name = m[1];
      }
    }
    /* 和英文那边同一个道理：中文的他/她也要走 probe，
       不然「我叫陈赫，是护工」里的「他」（如果有）会记成老人的性别。 */
    if (!p.gender){
      if (/她/.test(probe))        p.gender = 'She / her';
      else if (/他们/.test(probe)) p.gender = 'They / them';
      else if (/他/.test(probe))   p.gender = 'He / him';
    }
    if (!p.lives){
      if (/一个人住|独居|自己住|独自居住|一个人过/.test(probe)) p.lives = 'Alone';
      else {
        m = text.match(/(?:和|跟|同)\s*(女儿|儿子|老伴|丈夫|妻子|老公|老婆|孙女|孙子|家人)\s*(?:一起)?住/);
        if (m) p.lives = ({'女儿':'Daughter','儿子':'Son','老伴':'Partner','丈夫':'Husband',
                           '妻子':'Wife','老公':'Husband','老婆':'Wife','孙女':'Granddaughter',
                           '孙子':'Grandson','家人':'Family'})[m[1]];
      }
    }
    if (!p.home){
      if (/一楼|底层|地面层|首层/.test(text))     p.home = 'Ground-floor flat';
      else if (/平房|独栋平层/.test(text))        p.home = 'Bungalow';
      else if (/养老院|护理院|敬老院/.test(text)) p.home = 'Care home';
      else if (/公寓|楼房|单元房/.test(text))     p.home = 'Flat';
    }
  }

  /* ── 这句话是不是从头到尾都在说医护自己？──────────────────
     「My name is Peter, I'm a care worker.」只提到了一个人，
     而且那个人是医护。但 MNEMO_LLM.extract() 是给家属版写的，
     它眼里只有「被访者」一种人，会把 Peter 抽成被访者姓名，
     于是老人那一栏也变成了 Peter。

     判据：认出了医护自己（姓名或角色），却完全没有任何
     指向被访者的线索（姓名/年龄/性别/同住/房型/行动/视力/记忆）。
     这种时候 extract 抽出来的人只可能是医护自己，一律不收。
     代价是「I'm Peter and the lady is called Ying Zhang」这种
     句式会漏掉老人的名字 —— 漏了可以在左边补，填错了要签字。 */
  p._selfOnly = !!(p.carerName || p.carerRole) &&
                !(p.name || p.age || p.gender || p.lives || p.home ||
                  p.mobility || p.vision || p.memory);

  return p;
};

/* verb 可以是字符串，也可以是 {en:'…'}。原来还支持 {zh:'…'}，随中文版删了。 */
/* ── 档案上有谁 ─────────────────────────────────────────────
   只从流程真的采集过的东西推：本人、你、你的团队。
   之前写死过「Mei Zhang · 孙女」和「R. Ellis · 职业治疗师」——
   这套流程从没问过家属是谁，那两行是编的。
   转介来源和同意范围那两行也去掉了，因为这一版不再收这两个字段。
   第 5 步和档案页共用这一份，免得两边各编一套。
   剩下 3 行，但两边的版面都留了 4 个行位 —— 多出来的那个由页面自己藏掉。 */
C.people = function(needOT, zh, cap){   /* zh 已废弃 */
  var d = C.data;
  var rows = [
    { n: d.name || ('(no name yet)'),
      /* 原来是 'The resident · owns this file'，12px 下要 150px，
         第 5 步这一列只有 140px，会被截成「owns thi…」。
         「档案属于她」这条信息右边的 Owner 标签已经说了，这里不用重复。 */
      r: 'The resident',
      p: 'Sees everything here, including your notes.',
      g: 'Owner', c:'' },
    { n: d.carerName || ('(you)'),
      r: (d.carerRole || ('Care worker')) + (' · you'),
      p: 'Sees notes, measurements and visit history.',
      g: 'You', c:'' }
  ];

  rows.push({ n: d.carerTeam || ('Your team'),
    r: 'Care system',
    p: 'Your notes go with it.',
    g: 'Export', c:'' });

  /* 等 OT 签字这件事本身还在（第 4 步会标出来），只是没有「谁」可以指名，
     所以挂在团队那一行上，不再假装有一个具体的转介人。 */
  if (needOT > 0){
    rows.push({ n: 'Still open',
      r: 'Outside sign-off',
      p: (needOT + ' change' + (needOT===1?'':'s') + ' wait on a professional sign-off.'),
      g: 'Waiting', c:'warn' });
  }

  if (cap && rows.length > cap) rows = rows.slice(0, cap);
  return rows;
};

C.report = function(hit, verb){
  if (!hit.length) return null;
  var en = (typeof verb === 'string') ? verb : ((verb && verb.en) || 'Filed under');
  if (hit.length === 1) return en + ' ' + hit[0] + '. Change it on the left if I got it wrong.';
  var last = hit.pop();
  return en + ' ' + hit.join(', ') + ' and ' + last + '. Change any of them on the left if I got it wrong.';
};

/* ── 对话坞 ─────────────────────────────────────────────── */
var msgs, lead, sayEl, sendBtn, greeted = false, PAGE = null;

C.push = function(text, cls){
  if (!msgs) return;
  if (!greeted && lead && lead.parentNode){ lead.parentNode.removeChild(lead); greeted = true; }
  var p = document.createElement('p');
  if (cls) p.className = cls;
  p.textContent = text;
  msgs.appendChild(p);
  msgs.scrollTop = msgs.scrollHeight;
};
C.thinking = function(on){
  if (!msgs) return;
  var old = $('dots'); if (old && old.parentNode) old.parentNode.removeChild(old);
  if (!on) return;
  if (!greeted && lead && lead.parentNode){ lead.parentNode.removeChild(lead); greeted = true; }
  var p = document.createElement('p');
  p.id = 'dots'; p.className = 'dots'; p.innerHTML = '<i></i><i></i><i></i>';
  msgs.appendChild(p);
  msgs.scrollTop = msgs.scrollHeight;
};

function reply(v){ return C.localReply(v, PAGE.tail); }

/* 已经确定是搭话：交给模型，接口挂了就用本地那句 */
function aside(text){
  if (!C.hasLLM()){ C.push(reply(text)); return; }
  C.thinking(true);
  C.floor(global.MNEMO_LLM.chat(text, PAGE.ctx()), 450).then(function(t){
    C.thinking(false);
    C.push(t || reply(text));
  });
}

function land(text){
  var patch = PAGE.parse(text);
  var hit = PAGE.apply(patch) || [];
  var msg = C.report(hit, PAGE.verb);
  if (msg) C.push(msg, 'ok');
  return !!msg;
}

function handle(text){
  if (C.noteLang(text)) C.render();      /* 切到中文了，整屏跟着换 */
  C.push(text, 'me');

  /* 先本地拦搭话和提问 —— 和另外两版同一道关。
     一句「hi」不该被当成待解析的信息。 */
  if (C.CHATTER.test(text) || C.isQuestion(text)){ aside(text); return; }

  if (!C.hasLLM()){
    if (!land(text)) C.push(PAGE.miss(false));
    return;
  }

  C.thinking(true);
  /* 一次调用同时判「是答案还是搭话」并写好回复 */
  C.floor(global.MNEMO_LLM.route(text, PAGE.question()))
    .then(function(r){
      C.thinking(false);
      if (r && r.intent === 'chat' && r.reply){ C.push(r.reply); return; }

      if (!PAGE.usesExtract){ if (!land(text)) softMiss(text); return; }

      /* 当成信息：本地解析 + 模型抽 name/age/gender，两边合并 */
      C.thinking(true);
      return global.MNEMO_LLM.extract(text).then(function(ex){
        C.thinking(false);
        var patch = PAGE.parse(text);
        /* extract() 只认「被访者」一种人 —— 家属版只有一个人要记，
           医护版这一屏有两个（你自己 + 你要去看的人）。
           所以整句只在说医护自己的时候，它抽出来的一律不能收，
           否则「My name is Peter, I'm a care worker」会把老人也写成 Peter。 */
        var selfOnly = !!patch._selfOnly;
        if (ex && !selfOnly){
          /* 再兜一层：名字和医护自己重了，无论如何都是串档 */
          var same = ex.name && patch.carerName &&
                     String(ex.name).trim().toLowerCase() === patch.carerName.trim().toLowerCase();
          if (ex.name && !patch.name && !same) patch.name = ex.name;
          if (ex.age  && !patch.age)  patch.age  = String(ex.age);
          if (ex.gender && !patch.gender)
            patch.gender = ex.gender === 'Male' ? 'He / him' : 'She / her';
        }
        var hit = PAGE.apply(patch) || [];
        var msg = C.report(hit, PAGE.verb);
        if (msg) C.push(msg, 'ok');
        if (msg) return;
        softMiss(text);
      });
    })
    .catch(function(){
      C.thinking(false);
      if (!land(text)) C.push(PAGE.miss(false));
    });
}

/* 判成答案却什么也没抽出来 → 别硬塞，回一句人话 */
function softMiss(text){
  C.thinking(true);
  return C.floor(global.MNEMO_LLM.chat(text, PAGE.ctx()), 300).then(function(c){
    C.thinking(false);
    C.push(c || reply(text));
  });
}

/* ── 下一步：探不到就说清楚，不甩 404 ───────────────────── */
C.wireNext = function(href, label){
  var btn = $('next'), note = $('nextnote');
  if (!btn) return;
  btn.addEventListener('click', function(){
    C.save();
    fetch(href, { method:'HEAD' })
      .then(function(r){ if (r.ok){ location.href = href; return; } throw 0; })
      .catch(function(){
        if (!note) return;
        note.textContent = 'Saved. ' + label + ' is not built yet.';
        note.classList.add('show');
        setTimeout(function(){ note.classList.remove('show'); }, 3200);
      });
  });
};


/* ── 对话坞放大 ──────────────────────────────────────────────
   医护版的对话坞被刻意压成右下角一小块（一次只看得见两三行），
   因为这一版是表单主导的 —— 对话是辅助，不该抢戏。
   但「辅助」不等于「够用」：真要让它改点什么、或者回头看刚才说过什么，
   60px 高的滚动窗口就不够了。

   所以给它一个放大：点一下，坞铺满**整个右半栏**（把上面那张回显卡
   一起盖住），底改成毛玻璃 —— 盖住的东西仍然透得出来，
   让人知道自己只是把一张纸推上来了，不是换了一页。
   左半边的录入面板一个像素都不遮：医护常常是一边看着表单一边问话的，
   所以这里**不加遮罩、不拦外面的点击**，只有按钮和 Esc 关得掉。

   五个步骤页的坞在结构和坐标上一模一样（left:924 top:633 468×156），
   所以这一整套写在内核里，五个页面一行都不用改。

   ⚠️ 这里占用了一个新的元素 id：**dockzoom**，页面里别再用。
      （原有的保留名单：saved · pct · bar · state · fWho · fMeta · msgs ·
        lead · say · send · composer · next · nextnote · stage · stagewrap · dots） */
var DOCK_CSS = [
  /* 折叠态：把消息区收窄 32px，给右上角那个按钮让出位置。
     和页面里的 `.dock .msgs` 选择器**权重相同**，靠「后来居上」生效 ——
     这份样式是 boot() 时 append 到 </head> 的，一定在页面样式之后。 */
  '.dock .msgs{ width:336px }',
  '.dock{ transition:left .30s cubic-bezier(.22,1,.36,1), top .30s cubic-bezier(.22,1,.36,1),' +
  ' width .30s cubic-bezier(.22,1,.36,1), height .30s cubic-bezier(.22,1,.36,1),' +
  ' background .30s ease, box-shadow .30s ease }',

  '.dockzoom{ position:absolute; right:14px; top:14px; z-index:2; width:26px; height:26px;' +
  ' border-radius:8px; border:1px solid var(--hair); background:rgba(255,255,255,.72);' +
  ' color:var(--mut); cursor:pointer; padding:0; display:grid; place-items:center;' +
  ' transition:border-color .16s ease, color .16s ease, background .16s ease }',
  '.dockzoom:hover{ border-color:var(--accent); color:var(--accent-d); background:#fff }',
  '.dockzoom:focus-visible{ outline:2px solid var(--accent); outline-offset:2px }',
  '.dockzoom svg{ display:block; width:12px; height:12px }',

  /* 放大态。右栏那张回显卡是 left:924 top:252 468×380（底 632），
     坞是 left:924 top:633 468×156（底 789）—— 上下各留 18px 咬边，
     正好把整条右栏包进去，又不碰到 1112,858 那个 Continue 按钮。 */
  /* 底色压到 .42 而不是 .58：底下压着的是一张**白卡**，白玻璃盖白卡
     等于一块纯白板，看不出是「盖上去的」还是「换了一页」。
     透一点，回显卡的字和线在后面浮成一层灰影，人才读得出这是一层纸。
     底色带一点暖（255,253,250）——纯白在这一套米色里是冷的。 */
  '.dock.is-big{ left:906px; top:234px; width:504px; height:573px; z-index:40;' +
  ' background:rgba(255,253,250,.42); border:1px solid rgba(255,255,255,.62);' +
  ' -webkit-backdrop-filter:blur(20px) saturate(1.5); backdrop-filter:blur(20px) saturate(1.5);' +
  ' box-shadow:0 22px 60px rgba(60,50,36,.20) }',
  '.dock.is-big .av{ left:26px; top:28px }',
  /* 放大之后字也跟着大半号 —— 这时候它是在被读，不是被瞥一眼 */
  '.dock.is-big .msgs{ left:74px; top:26px; width:404px; height:452px;' +
  ' font-size:14.5px; line-height:22px }',
  '.dock.is-big .composer{ left:26px; top:498px; width:452px }',
  /* 玻璃上的按钮：白描边会整个消失，要给一道能看见的细线 */
  '.dock.is-big .dockzoom{ background:rgba(255,255,255,.66); border-color:rgba(120,110,96,.30) }',
  /* 消息文字压在玻璃上，比在实底上再深一档才读得住 */
  '.dock.is-big .msgs{ color:#5C564E }',
  '.dock.is-big .msgs p.me{ color:var(--ink) }'
].join('\n');

var ICON_BIG   = '<svg viewBox="0 0 13 13" fill="none" aria-hidden="true">' +
  '<path d="M1 5V1h4M12 8v4H8M1 1l4.4 4.4M12 12L7.6 7.6" stroke="currentColor"' +
  ' stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
/* 收起 = 把放大那个图标整个中心对称一次：角上的括号挪到中间、
   尾巴甩向四角，箭头就从「指向角」变成「指回中心」。
   第一版把两条对角线写反了，画出来是个「井」字 —— 这种图标必须实际渲一次看。 */
var ICON_SMALL = '<svg viewBox="0 0 13 13" fill="none" aria-hidden="true">' +
  '<path d="M5.4 1.4V5.4H1.4M1 1L5.4 5.4M7.6 11.6V7.6H11.6M12 12L7.6 7.6" stroke="currentColor"' +
  ' stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

C.wireDockZoom = function(){
  var dock = document.querySelector('.dock');
  if (!dock || $('dockzoom')) return;          /* 档案页没有坞，直接不做 */

  var st = document.createElement('style');
  st.textContent = DOCK_CSS;
  document.head.appendChild(st);

  var b = document.createElement('button');
  b.type = 'button'; b.id = 'dockzoom'; b.className = 'dockzoom';
  b.setAttribute('aria-controls', 'msgs');
  dock.appendChild(b);

  function paint(on){
      dock.classList.toggle('is-big', on);
    b.setAttribute('aria-expanded', on ? 'true' : 'false');
    b.innerHTML = on ? ICON_SMALL : ICON_BIG;
    var lab = on ? ('Shrink the conversation')
                 : ('Open the conversation full size');
    b.setAttribute('aria-label', lab);
    b.title = lab;
    /* 放大/收起都把消息滚到底：换了高度之后 scrollTop 保持原值，
       会停在中间某一句上，看着像丢了消息。 */
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  }
  paint(false);

  b.addEventListener('click', function(){
    var on = !dock.classList.contains('is-big');
    paint(on);
    if (on && sayEl) sayEl.focus();
  });
  /* Esc 收起。页面自己的浮层（比如第 3 步的放大平面）如果也听 Esc，
     那边是在 boot() **之前**注册的，所以它先跑；它关掉自己之后
     调一次 stopImmediatePropagation()，这里就不会跟着一起收。 */
  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape' && dock.classList.contains('is-big')){
      paint(false);
      if (b.focus) b.focus();
    }
  });
};

/* ── 发送键：没打字就是灰的（2026-09-16）────────────────────
   原来它永远是"墨底 + 橙箭头"，看上去随时可以按，按下去却什么也不发生
   —— 一个按了没反应的按钮，比一个明说"现在不能按"的按钮更让人犯嘀咕。

   只听 input 事件不够：代码里清空输入框（发完一句）不会触发 input，
   所以发完之后那个 setTimeout 改成重算，而不是无条件放开。

   Enter 键照旧能用 —— submit 处理器自己 return 掉空串，
   禁用的只是那个按钮，不是整条输入线。

   页面里原来那条 `.send:disabled{opacity:.45}` 只是把它整个调淡，
   连橙箭头一起淡 —— 看着像"坏了"。这里改成真的换成灰底灰箭头。
   样式是 boot() 时 append 到 </head> 的，和页面里那条权重相同、后来居上。
   档案页没有对话坞，$('say') 取不到，整段直接跳过。 */
var SEND_CSS =
  '.send:disabled{ opacity:1; background:var(--chipbg); color:var(--mut);' +
  ' cursor:default; transform:none }' +
  '.send:disabled:hover{ transform:none; background:var(--chipbg) }';

C.syncSend = function(){
  if (sendBtn && sayEl) sendBtn.disabled = !sayEl.value.trim();
};
C.wireSend = function(){
  if (!sayEl || !sendBtn) return;
  var st = document.createElement('style');
  st.textContent = SEND_CSS;
  document.head.appendChild(st);
  sayEl.addEventListener('input', C.syncSend);
  C.syncSend();
};

/* ── 启动 ───────────────────────────────────────────────── */
C.boot = function(page){
  PAGE = page;
  /* ⚠️ 这是**第二次** load —— 本文件末尾已经 load 过一次了。
     后果：页面脚本在 C.boot() 之前给 data 设的任何默认值，都会被
     这一次 load 用 sessionStorage 里的旧值盖回去（空字符串也算数，
     load 的判断是 `s[k] != null`）。flow-carer-3 的方案默认值
     2026-09-17 就是栽在这儿的。
     所以：**页面脚本要设默认值，一律写在 C.boot() 之后**，
     并且跟一句 C.stamp(); C.render(); 让它存下去。 */
  C.load();
  C.fitStage();

  msgs = $('msgs'); lead = $('lead'); sayEl = $('say'); sendBtn = $('send');
  C.wireSend();
  var form = $('composer');
  if (form) form.addEventListener('submit', function(e){
    e.preventDefault();
    var v = sayEl.value.trim(); if (!v) return;
    sayEl.value = '';
    sendBtn.disabled = true;
    /* 300ms 之后**不是无条件放开**，而是照输入框现在的内容重算 ——
       刚发完那一句输入框是空的，所以它应该继续是灰的。 */
    setTimeout(C.syncSend, 300);
    handle(v);
  });

  C.wireDockZoom();
  if (page.next) C.wireNext(page.next.href, page.next.label);

  C.render = function(){
    page.render(); C.paintHead(); C.paintProgress();
    /* 锁上之后不再写回 —— 否则第 5 步之外的页面一渲染就把数据又存一遍 */
    if (!C.locked()) C.save();
    C.applyLock();
  };
  C.stamp();
  C.render();
};

/* 立刻读档，不等 boot()。
   页面脚本在这个文件之后执行，里面会用 data[k] 回填输入框；
   把 load() 留在 boot() 里，那些回填全是空的 —— 刷新一次数据就"看不见"了
   （其实还在 sessionStorage 里，只是没画出来，更难查）。 */
C.load();

global.MNEMO_CARER = C;
})(window);
