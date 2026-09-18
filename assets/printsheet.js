/* ============================================================
   MNEMO · 一页纸（Download PDF / Print the plan）  2026-09-16
   ------------------------------------------------------------
   为什么要单独做一张纸：
     直接 window.print() 打出来的是**当前这一屏** —— 流程页会把整条
     聊天记录、步骤条、输入框一起印出去，那不是任何人想要的 PDF。

     这里在打印前临时拼一张真正的一页纸：选中的那张平面 + 她的卡片 +
     分数 + 这套方案过了哪几条规则。印完就把它撤掉，页面不受影响。

   为什么不做真 PDF：
     不需要。浏览器打印对话框里选「另存为 PDF」出来的就是 PDF，
     不用后端、不用第三方库、发布出去照样能用 —— 和
     00-可行性判断.md 里定的"全静态托管"是一条路子。

   ⚠️ 纸上只印页面上**已经有的**东西：平面是模板里那张，分数和规则
     照抄 S3_OPT / OPT。不另算、不补写，免得纸面和屏幕对不上。

   用法：
     MNEMO_PRINT.sheet({
       title:'Ying Zhang · Type B · Option C',
       sub:'MNEMOSYNE — room plan',
       planSVG:'<svg …>',              // 整段 SVG 字符串
       facts:[['Name','Ying Zhang'],…], // 左栏事实
       score:'8.2',
       rules:['Corridors ≥ 1400 mm', …]
     });
   ============================================================ */
(function (root, doc) {
'use strict';

var CSS = [
  '#mnemo-print{display:none}',
  '@media print{',
  '  html,body{background:#fff !important}',
  '  body > *{display:none !important}',
  '  #mnemo-print{display:block !important;position:static;',
  '    font:12pt/1.45 Georgia,"Times New Roman",serif;color:#1A1917;padding:0}',
  '  #mnemo-print .ph{display:flex;justify-content:space-between;align-items:baseline;',
  '    border-bottom:1.5pt solid #1A1917;padding-bottom:6pt;margin-bottom:16pt}',
  '  #mnemo-print .ph h1{margin:0;font-size:17pt;font-weight:700;letter-spacing:-.01em}',
  '  #mnemo-print .ph .sub{font-size:9pt;letter-spacing:.14em;text-transform:uppercase;color:#6B6459}',
  '  #mnemo-print .pbody{display:flex;gap:22pt;align-items:flex-start}',
  '  #mnemo-print .pplan{flex:1 1 auto;min-width:0}',
  '  #mnemo-print .pplan svg{width:100%;height:auto;max-height:150mm}',
  '  #mnemo-print .pside{flex:0 0 58mm}',
  '  #mnemo-print .pscore{font-size:34pt;font-weight:700;line-height:1;margin:0 0 2pt}',
  '  #mnemo-print .pscorek{font-size:8.5pt;letter-spacing:.12em;text-transform:uppercase;',
  '    color:#6B6459;margin:0 0 14pt}',
  '  #mnemo-print dl{margin:0 0 14pt}',
  '  #mnemo-print dt{font-size:8.5pt;letter-spacing:.1em;text-transform:uppercase;color:#6B6459;margin-top:7pt}',
  '  #mnemo-print dd{margin:1pt 0 0;font-size:11pt}',
  '  #mnemo-print .prules{margin:0;padding:0;list-style:none;border-top:.6pt solid #CFC8BB;padding-top:8pt}',
  '  #mnemo-print .prules li{font-size:10pt;margin:0 0 4pt}',
  /* ── 第 1 页：平面下面的造价小结 ───────────────────── */
  '  #mnemo-print .pcost{margin-top:16pt;border-top:1.2pt solid #1A1917;padding-top:7pt}',
  '  #mnemo-print .pcost .ck{margin:0 0 6pt;font-size:8.5pt;letter-spacing:.12em;',
  '    text-transform:uppercase;color:#6B6459}',
  '  #mnemo-print .pcost .cwrap{display:flex;gap:22pt;align-items:flex-start}',
  '  #mnemo-print .pcost .clist{flex:1 1 auto;margin:0;padding:0;list-style:none}',
  '  #mnemo-print .pcost .clist li{display:flex;justify-content:space-between;',
  '    align-items:baseline;gap:10pt;padding:2.5pt 0;border-bottom:.4pt solid #E7E1D6}',
  '  #mnemo-print .pcost .clist li:last-child{border-bottom:0}',
  '  #mnemo-print .pcost .cg{font-size:10pt}',
  '  #mnemo-print .pcost .cg i{font-style:normal;font-size:8.5pt;color:#6B6459;margin-left:5pt}',
  '  #mnemo-print .pcost .cn{font-size:10pt;white-space:nowrap}',
  '  #mnemo-print .pcost .ctot{flex:0 0 58mm;text-align:right}',
  '  #mnemo-print .pcost .cbig{margin:0;font-size:24pt;font-weight:700;line-height:1.05}',
  '  #mnemo-print .pcost .csub{margin:3pt 0 0;font-size:8.5pt;letter-spacing:.1em;',
  '    text-transform:uppercase;color:#6B6459}',
  '  #mnemo-print .pcost .csub2{margin:5pt 0 0;font-size:8.5pt;color:#6B6459}',
  '  #mnemo-print .pfoot{margin-top:18pt;border-top:.6pt solid #CFC8BB;padding-top:6pt;',
  '    font-size:8.5pt;color:#6B6459}',
  /* ── 第 2 页：指示性造价 ──────────────────────────────
     单独一页，不挤在平面那一页上 —— 挤进去两样都读不清。
     break-before 是标准属性，page-break-before 留着给老一点的引擎。 */
  '  #mnemo-print .pq{page-break-before:always;break-before:page;padding-top:2pt}',
  '  #mnemo-print .pq table{width:100%;border-collapse:collapse;margin-top:10pt}',
  '  #mnemo-print .pq th{font-size:8pt;letter-spacing:.1em;text-transform:uppercase;',
  '    color:#6B6459;text-align:left;font-weight:400;border-bottom:.6pt solid #CFC8BB;padding:0 0 4pt}',
  '  #mnemo-print .pq th.n,#mnemo-print .pq td.n{text-align:right;white-space:nowrap}',
  '  #mnemo-print .pq td{font-size:10.5pt;padding:4.5pt 0;border-bottom:.4pt solid #E7E1D6;',
  '    vertical-align:top}',
  '  #mnemo-print .pq td.d span{display:block;font-size:8.5pt;color:#6B6459;margin-top:1pt}',
  '  #mnemo-print .pq tr.sum td{border-bottom:0;padding-top:7pt;font-size:11pt}',
  '  #mnemo-print .pq tr.tot td{border-top:1.2pt solid #1A1917;font-size:13pt;font-weight:700;',
  '    padding-top:7pt}',
  '  #mnemo-print .pq .qnote{margin:14pt 0 0;font-size:8.5pt;line-height:1.5;color:#6B6459}',
  '  #mnemo-print .pq .qnote b{color:#1A1917}',
  '  @page{margin:16mm}',
  '}'
].join('');

/* ═══ 指示性造价 ═════════════════════════════════════════════
   ⚠️ 单价是**编的**（用户 2026-09-17 要求「价格自己编」），没有真实报价依据。
   但数量不是凑的：全部由已经选定的户型 / 方案 / 分流推出来，
   所以换一个户型或方案，报价会跟着动 —— 一张怎么选都一样的报价一眼就假。

   三处调用（flow.html 第 5 步、flow-resident.html 的 Share、
   home-file-resident.html 的 Print）共用这一份，不各写一套：
   抄两份早晚会出现同一间房两个价。
   ═══════════════════════════════════════════════════════════ */
var RATE = {
  cube:     148,   /* 一个 300 mm 铝框模块，含六面板 */
  bar:      210,   /* 功能条（灯带 / 走线 / 扶手接口），按房间算 */
  rail:      96,   /* 连续扶手，每米 */
  tactile:   54,   /* 触感墙板，每块 */
  colour:    38,   /* 颜色提示面板，每块 */
  light:     165,  /* 自适应灯光层，按房间算 */
  survey:   480,   /* 现场测绘 */
  generate: 260,   /* MNEMO 布局生成与评分 */
  delivery: 180,
  fitDay:   320    /* 一名安装工一天 */
};
/* 户型决定基础用量；方案 C 走廊最宽、回转口最多，框架用得更多 */
var HOME  = { A:{ cubes:84, rooms:4 }, B:{ cubes:96, rooms:4 }, C:{ cubes:112, rooms:5 } };
var OPTUP = { A:0, B:6, C:14 };
/* 分流决定配件：行动要扶手，视力要触感和对比，记忆要颜色提示 */
var TRK   = { mobility:{ rail:22, tactile:0,  colour:0  },
              vision:  { rail:10, tactile:18, colour:0  },
              memory:  { rail:6,  tactile:0,  colour:24 } };

function money(n){
  return '£' + Math.round(n).toLocaleString('en-GB');
}

/* 传 { type:'B', option:'C', track:'mobility' }，返回 sheet() 要的 quote 对象 */
function quote(o){
  o = o || {};
  var h = HOME[o.type] || HOME.A;
  var t = TRK[o.track] || TRK.mobility;
  var cubes = h.cubes + (OPTUP[o.option] || 0);
  var rooms = h.rooms;
  var days  = Math.ceil(cubes / 45);          /* 两个人一天装 45 个模块 */
  var fitters = 2;

  var rows = [];
  function row(d, note, qty, unit, rate){
    var amt = qty * rate;
    rows.push({ d:d, note:note, qty:qty + ' ' + unit, rate:rate, amt:amt });
    return amt;
  }
  var sub = 0;
  sub += row('Cube modules', '300 mm aluminium frame, six panels', cubes, 'no.', RATE.cube);
  sub += row('Function bars', 'lighting, cable route, rail sockets', rooms, 'rooms', RATE.bar);
  if (t.rail)    sub += row('Continuous handrail', 'grown from the furniture line', t.rail, 'm', RATE.rail);
  if (t.tactile) sub += row('Tactile wall panels', 'raised symbols and grip rails', t.tactile, 'no.', RATE.tactile);
  if (t.colour)  sub += row('Colour-cue panels', 'one fixed hue per zone', t.colour, 'no.', RATE.colour);
  sub += row('Adaptive lighting layer', 'ceiling, edge, panel, floor route', rooms, 'rooms', RATE.light);
  sub += row('Measured survey', 'existing plan, openings, clearances', 1, 'visit', RATE.survey);
  sub += row('Layout generation and scoring', 'MNEMO, three candidate layouts', 1, 'plan', RATE.generate);
  sub += row('Delivery', 'flat-packed, one drop', 1, 'load', RATE.delivery);
  sub += row('Installation', fitters + ' fitters, tool-free assembly',
             fitters * days, 'days', RATE.fitDay);

  var cont = sub * 0.08;

  /* 第 1 页放不下十行明细，所以按「读的人真正想知道的四块」归并。
     归并是从 rows 现算的，不另写一份数 —— 两份数早晚会对不上。 */
  function pick(){
    var want = [].slice.call(arguments), t = 0;
    for (var i = 0; i < rows.length; i++)
      if (want.indexOf(rows[i].d) > -1) t += rows[i].amt;
    return t;
  }
  var groups = [
    ['Cube system', cubes + ' modules', pick('Cube modules')],
    ['Fittings and lighting', 'bars, rails, panels', pick(
        'Function bars', 'Continuous handrail', 'Tactile wall panels',
        'Colour-cue panels', 'Adaptive lighting layer')],
    ['Survey and design', 'visit, layout, scoring', pick(
        'Measured survey', 'Layout generation and scoring')],
    ['Delivery and installation', days + ' days, two fitters', pick('Delivery', 'Installation')],
    ['Contingency at 8%', 'tolerances, making good', cont]
  ];

  return { rows:rows, groups:groups, subtotal:sub, contingency:cont, total:sub + cont,
           cubes:cubes, days:days };
}

/* 第 1 页平面图下面那块造价小结。
   放在 .pbody 和 .pfoot 之间 —— 页脚那句免责声明理应在整页最后一行，
   小结插在它前面，正好落在平面图下方原本空着的那一片。 */
function costHTML(q){
  if (!q || !q.groups) return '';
  var li = q.groups.map(function(g){
    return '<li><span class="cg">' + esc(g[0])
         + (g[1] ? '<i>' + esc(g[1]) + '</i>' : '') + '</span>'
         + '<span class="cn">' + money(g[2]) + '</span></li>';
  }).join('');
  return '<div class="pcost">'
    + '<p class="ck">Indicative cost</p>'
    + '<div class="cwrap">'
    +   '<ul class="clist">' + li + '</ul>'
    +   '<div class="ctot"><p class="cbig">' + money(q.total) + '</p>'
    +     '<p class="csub">Indicative total \u00b7 excl. VAT</p>'
    +     '<p class="csub2">Itemised overleaf. Modelled, not quoted.</p></div>'
    + '</div></div>';
}

function quoteHTML(q, title){
  if (!q || !q.rows || !q.rows.length) return '';
  var tr = q.rows.map(function(r){
    return '<tr><td class="d">' + esc(r.d)
         + (r.note ? '<span>' + esc(r.note) + '</span>' : '') + '</td>'
         + '<td class="n">' + esc(r.qty) + '</td>'
         + '<td class="n">' + money(r.rate) + '</td>'
         + '<td class="n">' + money(r.amt) + '</td></tr>';
  }).join('');
  return '<div class="pq">'
    + '<div class="ph"><h1>Indicative costing</h1>'
    +   '<span class="sub">' + esc(title || 'MNEMOSYNE') + '</span></div>'
    + '<table><thead><tr><th>Item</th><th class="n">Qty</th>'
    +   '<th class="n">Rate</th><th class="n">Amount</th></tr></thead><tbody>'
    + tr
    + '<tr class="sum"><td class="d">Subtotal</td><td></td><td></td>'
    +   '<td class="n">' + money(q.subtotal) + '</td></tr>'
    + '<tr class="sum"><td class="d">Contingency at 8%'
    +   '<span>survey tolerances and making good</span></td><td></td><td></td>'
    +   '<td class="n">' + money(q.contingency) + '</td></tr>'
    + '<tr class="tot"><td class="d">Indicative total, excluding VAT</td><td></td><td></td>'
    +   '<td class="n">' + money(q.total) + '</td></tr>'
    + '</tbody></table>'
    + '<p class="qnote"><b>This is an indicative costing, not a quotation.</b> '
    +   'Rates are modelled for the ' + esc(String(q.cubes)) + '-module build shown on the '
    +   'previous page and have not been confirmed with a supplier or fitter. '
    +   'Quantities follow the layout you chose, so a different home type or option '
    +   'gives a different figure. Installation assumes ' + esc(String(q.days))
    +   ' working days for two fitters with the room in use. '
    +   'VAT treatment depends on who the work is for and is not included.</p>'
    + '</div>';
}


function esc(s){
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function sheet(o){
  o = o || {};
  var box = doc.getElementById('mnemo-print');
  if (!box){
    var st = doc.createElement('style');
    st.id = 'mnemo-print-css';
    st.textContent = CSS;
    doc.head.appendChild(st);
    box = doc.createElement('div');
    box.id = 'mnemo-print';
    doc.body.appendChild(box);
  }
  var facts = (o.facts || []).map(function(f){
    return '<dt>' + esc(f[0]) + '</dt><dd>' + esc(f[1]) + '</dd>';
  }).join('');
  var rules = (o.rules || []).map(function(r){
    return '<li>✓ ' + esc(r) + '</li>';
  }).join('');

  box.innerHTML =
      '<div class="ph"><h1>' + esc(o.title || 'Room plan') + '</h1>'
    + '<span class="sub">' + esc(o.sub || 'MNEMOSYNE') + '</span></div>'
    + '<div class="pbody">'
    +   '<div class="pplan">' + (o.planSVG || '') + '</div>'
    +   '<div class="pside">'
    +     (o.score ? '<p class="pscore">' + esc(o.score) + '</p>'
                   + '<p class="pscorek">Room score</p>' : '')
    +     (facts ? '<dl>' + facts + '</dl>' : '')
    +     (rules ? '<ul class="prules">' + rules + '</ul>' : '')
    +   '</div>'
    + '</div>'
    + costHTML(o.quote)
    + '<p class="pfoot">' + esc(o.foot
        || 'Printed from MNEMOSYNE. The plan is drawn to the rules listed — '
         + 'nothing on this sheet is a building approval.') + '</p>'
    + quoteHTML(o.quote, o.title);

  /* 让排版先落定再调打印，否则 Safari 偶尔印出半张 */
  setTimeout(function(){ try{ root.print(); }catch(e){} }, 120);
}

root.MNEMO_PRINT = { sheet:sheet, quote:quote, money:money };

})(window, document);
