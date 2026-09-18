/* ═══════════════════════════════════════════════════════════════
   MNEMO · 自然语言 → 选项 的关键词表（三版共用）
   ───────────────────────────────────────────────────────────────
   这一份是从 flow.html（家属版）原样抽出来的，一个字都没改。

   为什么要抽出来：医护版原先在 carer-core.js 里自己写了一套简版
   规则，结果同样的话两版认得不一样 —— 实测家属版认得
   「zimmer」「gets around fine」「走路没问题」，医护版都不认。
   同一个人由谁来填，结论必须一样，所以规则只能有一份。

   ⚠️ flow.html 目前**仍然内联着自己那一份**（暂时没动，减少改动面）。
   改这里的规则时，flow.html 里那一份要同步改，否则两版又会走岔。
   下次要动 flow.html 的时候，把内联那份删掉、改成引用本文件。

   用法：
     <script src="assets/nlu-rules.js"></script>
     MNEMO_NLU.pickLocal(text, ['Wheelchair indoors', 'Uses a cane', …])
       → 命中的标签数组，按原顺序，「没问题」类和具体症状互斥
   ═══════════════════════════════════════════════════════════════ */
(function (global) {
'use strict';

var CLEAR = /^(?:No issues|Walks unaided)$/;   // 和具体症状互斥
var NEG_EN = /\b(?:no|not|never|without|hardly|barely|doesn'?t|does not|didn'?t|isn'?t|won'?t|cannot|can'?t|don'?t)\b[^.;!?]{0,12}$/i;
var NEG_CN = /[不没无未别][^。；！？，,]{0,5}$/;
/* NEG_SAFE 里的标签会**跳过否定词检查**，直接 re.test()。
   放进来的前提是「这个标签的规则本身就全是否定表述」，
   不然否定句会被读成肯定句。

   ⚠️ 'Walks unaided' 和 'Lives alone' 原来在这里，是错的 —— 它们的规则里
   混着大量**肯定**表述（利索 / 腿脚好 / 一个人 / 自己住）。实测：
     「她腿脚不太利索」→ Walks unaided   （完全反了）
     「她不是一个人住」→ Lives alone     （完全反了）
   填反比认不出严重得多，所以把这两个移出去，照常过否定词检查。
   它们规则里自带的 no help / nobody / 没有人 不受影响 ——
   否定检查看的是命中位置**之前**有没有否定词，不是命中内容本身。 */
var NEG_SAFE = /^(?:Cannot manage steps|Cannot read small print|Very limited vision|No issues|Rarely|Prefer not to say)$/;
var PICK_RULES = {

  /* ── 行动（多选，权重最高，错了整条流程都歪） ────────── */
  'Wheelchair indoors'  : /wheel\s*-?\s*chair|轮椅/i,
  'Cannot manage steps' : /steps?\b|stairs|staircase|\bkerb\b|\bcurb\b|climb|上不了|爬不了|台阶|楼梯|上下楼|门槛|坡/i,
  'Unsteady when turning': /unsteady|unstable|off\s*balance|\bbalance\b|wobbl|shaky|shakes|totter|sway|dizzy|light-?headed|turning|falls? over|容易摔|会摔|转[身弯]|不稳|站不稳|发晃|摇晃|晃悠|头晕|平衡/i,
  'Uses a walking frame': /walking\s*frame|\bwalker\b|zimmer|rollator|\bframe\b|助行[器架]|助步器|扶车|四脚|推车/i,
  'Uses a cane'         : /\bcane\b|walking\s*stick|\bstick\b|crutch|拐杖|手杖|拄拐|单拐|棍/i,
  'Walks unaided'       : /unaided|without (?:help|aid|support)|no help|walks (?:fine|well|ok)|no (?:trouble|problem|issue)s? walking|gets around fine|independent|自己走|自己能走|不用扶|不用人扶|走路.{0,4}没(?:有)?问题|行动自如|腿脚.{0,3}好|利索|没什么问题/i,

  /* ── 视力（多选） ──────────────────────────────── */
  'Very limited vision' : /\bblind\b|very limited|barely see|hardly see|almost no sight|severe|registered blind|失明|看不见|基本看不|几乎看不|视力(?:很|极|非常)?[差弱]|重度/i,
  'Weaker at night'     : /at night|in the dark|night\s*-?\s*time|after dark|poor light|dim light|低照度|夜里|夜间|晚上|天黑|暗处|光线暗|背光/i,
  'Needs strong contrast': /contrast|tell.{0,12}apart|blends? in|edges?\b|分不清颜色|分不出|对比度?|看不出边|深浅/i,
  'Cannot read small print': /small print|fine print|can'?t read|cannot read|hard to read|struggles? to read|reading glasses|labels?\b|newspaper|小字|看不清字|读不了字|老花|看不了报/i,

  /* ── 记忆（多选） ──────────────────────────────── */
  'Gets disoriented at night': /disorient|gets? lost|confus|wander|lost at night|up at night|(?:夜里|晚上|夜间)[^，。；！？]{0,3}(?:迷路|迷向|迷糊)|夜里找不到|晚上找不到|起夜|走错|糊涂|不认路/i,
  'Needs colour cues'   : /colou?r|cues?\b|labels? help|signs? help|颜色|靠颜色|标[识记]|贴纸|提示牌/i,
  'Forgets where things are': /forget|forgetful|misplace|loses? things|can'?t remember|cannot remember|忘[记了事]|记不[住清得]|想不起|丢三落四|找不到东西|记性(?:不好|差)/i,

  /* ── 视力 / 记忆共用的"没问题" ────────────────────── */
  'No issues'           : /^\s*(?:no|none|nope|nothing|没有|无|不用|没)\s*[.。!！]?\s*$|no\s+(?:\w+\s+)?issues?|nothing wrong|no\s+(?:\w+\s+)?problems?|all good|\bfine\b|\bokay\b|\bnormal\b|没[有什]*问题|正常|挺好|都好|还行|还好|不错/i,

  /* ── 性别（单选） ──────────────────────────────── */
  'Female'              : /\bfemale\b|\bwoman\b|\blady\b|\bshe\b|\bher\b|\bmrs\b|\bms\b|grand\s*(?:ma|mother)|\bmum\b|\bmom\b|\bmother\b|\bnan\b|\bwife\b|\bdaughter\b|女[性的士]?|奶奶|外婆|姥姥|妈妈|母亲|婆婆|老太太|女儿|孙女|外孙女|她/i,
  'Male'                : /\bmale\b|\bman\b|\bhe\b|\bhis\b|\bhim\b|\bmr\b|grand\s*(?:pa|father)|\bdad\b|\bfather\b|\bhusband\b|\bson\b|男[性的士]?|爷爷|外公|姥爷|爸爸|父亲|公公|老爷子|老先生|儿子|孙子|外孙|他(?!们)/i,
  'Prefer not to say'   : /prefer not|rather not|don'?t want to say|not relevant|不想说|不方便说|不填|不重要|保密/i,

  /* ── 同住的人（单选） ───────────────────────────── */
  'Lives alone'         : /\balone\b|by (?:her|him)self|on (?:her|his) own|\bnobody\b|no ?-?one\b|just (?:her|him)\b|only (?:her|him)\b|lives solo|empty nest|一个人|独居|自己住|独自|没(?:有)?(?:别的?)?人|就她自己|就他自己|没人跟|没别人|空巢|单独住/i,
  'With family'         : /with (?:her|his)? ?family|lives with|with (?:her|his) (?:son|daughter|children|kids|husband|wife|partner|grandchild)|和?家人一?起?住|跟家人|和子女|儿子|女儿|老伴|配偶|孙[子女]|一起住|同住|儿媳|女婿/i,
  'With a live-in carer': /carer|caregiver|care\s*-?\s*worker|\bnurse\b|\bhelper\b|\baide\b|housekeeper|live-?in|保姆|护工|住家|陪护|看护|请了人|钟点/i,

  /* ── 见邻居的频率（单选） ──────────────────────── */
  'Most days'           : /most days|every\s*-?\s*day|everyday|daily|all the time|\boften\b|frequently|a lot\b|several times a week|天天|每天|经常|常常|时常|很频繁|差不多每天/i,
  'Weekly'              : /weekly|once a week|twice a week|a week\b|每周|一周|每星期|一星期|周末/i,
  /* 「Never」最容易被忘掉 —— 它不是"很少"的同义词，
     但在只有三档的量表上，它落在 Rarely 这一档。 */
  'Rarely'              : /rarely|seldom|hardly|barely|almost never|\bnever\b|not really|no contact|once in a while|occasionally|now and then|a few times a year|从不|从来不|不来往|没来往|很少|基本不|几乎不|不太(?:来|去|见|走动|出门|联系|往来|串门)|没有往来|偶尔|一年.{0,3}[几两三]次|不怎么/i,

  /* ── 三轴并列时的追问（单选） ──────────────────── */
  'Mobility'            : /mobilit|moving|walking|getting around|\blegs?\b|行动|走路|腿脚|移动|出行/i,
  'Vision'              : /vision|sight|\beyes?\b|seeing|eyesight|视力|眼睛|看东西|看不清/i,
  'Memory'              : /memory|remember|forget|cognit|记忆|记性|忘/i
};
function hitPositive(re, v){
  var g = new RegExp(re.source, re.flags.indexOf('g') > -1 ? re.flags : re.flags + 'g');
  var m;
  while ((m = g.exec(v)) !== null){
    if (m.index === g.lastIndex) g.lastIndex++;          // 防零长匹配死循环
    var before = v.slice(0, m.index);
    if (NEG_EN.test(before) || NEG_CN.test(before)) continue;
    return true;
  }
  return false;
}
function tidyPicks(list){
  var real = list.filter(function(l){ return !CLEAR.test(l); });
  return real.length ? real : list;
}
function pickLocal(v, labels){
  var lv = v.trim().toLowerCase(), out = [], i;

  /* ① 先看有没有把选项本身说出来。整词匹配 ——
     用 indexOf 的话 "female" 里含 "male"，两个都会中。 */
  for (i=0;i<labels.length;i++){
    var L = labels[i].toLowerCase();
    var whole = new RegExp('(^|[^a-z])' + L.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '([^a-z]|$)', 'i');
    if (lv === L || whole.test(lv)) out.push(labels[i]);
  }
  if (out.length) return tidyPicks(out);

  /* ② 再查关键词表，命中之后还要过否定词那一关 */
  for (i=0;i<labels.length;i++){
    var re = PICK_RULES[labels[i]];
    if (!re) continue;
    var ok = NEG_SAFE.test(labels[i]) ? re.test(v) : hitPositive(re, v);
    if (ok) out.push(labels[i]);
  }
  return tidyPicks(out);
}

/* 中文数字 → 阿拉伯数字（9999 以内）。
   医护版和家属版都要用（年龄「今年八十二」、尺寸「门洞八百」），
   所以放在这一份共享文件里，不各写一遍。
   算法按「位」累加，不能一路乘十 ——
   写成 section = section*10 + digit 的时候「七十六」会算成 706。
   末位的量级口语会省掉：「一千二」= 1200、「一百五」= 150。 */
var CN_DIGIT = { '零':0,'〇':0,'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9 };
function cnNum(str){
  if (/^\d+$/.test(str)) return parseInt(str, 10);
  var t = String(str), total = 0, digit = 0, i, ch, used = false, lastUnit = 1;
  for (i = 0; i < t.length; i++){
    ch = t.charAt(i);
    if (CN_DIGIT[ch] !== undefined){ digit = CN_DIGIT[ch]; used = true; }
    else if (ch === '十'){ total += (digit || 1) * 10;   digit = 0; lastUnit = 10;   used = true; }
    else if (ch === '百'){ total += (digit || 1) * 100;  digit = 0; lastUnit = 100;  used = true; }
    else if (ch === '千'){ total += (digit || 1) * 1000; digit = 0; lastUnit = 1000; used = true; }
    else return null;
  }
  if (digit) total += (lastUnit >= 10) ? digit * (lastUnit / 10) : digit;
  return (used && total > 0) ? total : null;
}

/* 从一句话里找年龄。带「岁 / years old」的最可信；
   裸数字只在 40–120 之间才当年龄 —— 放宽到 1–120 的话
   「她住 3 楼」会被记成 3 岁、「门牌 12 号」记成 12 岁。 */
function ageIn(text){
  var t = String(text || ''), m, n;
  m = t.match(/(\d{1,3})\s*(?:岁|years?\s*old|yo\b)/i);
  if (m){ n = parseInt(m[1],10); if (n >= 1 && n <= 120) return String(n); }
  m = t.match(/(?:今年|年纪|岁数|虚岁)\s*([一二两三四五六七八九十百]{2,4})|([一二两三四五六七八九十百]{2,4})\s*岁/);
  if (m){ n = cnNum(m[1] || m[2]); if (n != null && n >= 1 && n <= 120) return String(n); }
  /* 「她七十二了」—— 口语里「岁」也会省掉。这条比上面弱，
     所以收紧到 40–120，免得把别的中文数字当年龄。 */
  m = t.match(/([一二两三四五六七八九十百]{2,4})\s*了/);
  if (m){ n = cnNum(m[1]); if (n != null && n >= 40 && n <= 120) return String(n); }
  m = t.match(/\b(\d{2,3})\b/);
  if (m){ n = parseInt(m[1],10); if (n >= 40 && n <= 120) return String(n); }
  return '';
}

global.MNEMO_NLU = {
  PICK_RULES:  PICK_RULES,
  pickLocal:   pickLocal,
  tidyPicks:   tidyPicks,
  /* parsePerson 里「同住」「房型」那几条是自己写的正则，不走 pickLocal，
     所以也拿不到否定词检查 —— 实测「她不是一个人住」被填成了 Alone。
     把这个导出去，那边就能用同一套否定判断。 */
  hitPositive: hitPositive,
  cnNum:       cnNum,
  ageIn:       ageIn
};
})(typeof window !== 'undefined' ? window : this);
