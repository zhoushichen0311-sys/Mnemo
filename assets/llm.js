/* ═══════════════════════════════════════════════════════════════
   MNEMO · LLM 调用层
   ───────────────────────────────────────────────────────────────
   这一层的全部意义在于：**上面那层永远不需要知道有没有网。**

   两个出口：
     MNEMO_LLM.chat(text, ctx)  → Promise<string|null>   自由问答
     MNEMO_LLM.extract(text)    → Promise<object|null>   抽结构化信息

   两条硬规矩（改这个文件时别破坏）：
     1. 任何情况下都 resolve，绝不 reject。失败一律给 null，
        调用方看到 null 就退回写死的行为。
     2. 超时就放弃。这页要能在会场 wifi 上演示。

   MOCK = true  → 本地假应答器，不联网、不花钱、不需要 key
   MOCK = false → 走真代理（URL 填 Cloudflare Worker 地址）
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* 接口地址：三种环境自动分流，不用每次发布前手改。

       ① 本地（localhost / 127.0.0.1 / file://）
          → tools 里那个黑窗口，8787

       ② Cloudflare Pages（*.pages.dev 或挂在上面的自定义域名）
          → 同域的 /chat，也就是根目录 _worker.js 提供的那个接口
          同源，没有 CORS，换域名也不用改代码

       ③ 其它任何地方（GitHub Pages 等纯静态托管）
          → 跨域打到 Cloudflare 那份 /chat
          纯静态托管跑不了服务端代码，而 key 绝对不能写进前端，
          所以只能借用 Cloudflare 那一份。_worker.js 已经带了
          Access-Control-Allow-Origin 和 OPTIONS 处理，跨域是通的。

     为什么要有 ③：GitHub Pages 在中国大陆比 Cloudflare 稳，
     用它托管页面本身，AI 那一个请求再回头找 Cloudflare。
     Cloudflare 那边不通时会走下面的「开局探测」逻辑，不会把页面拖住。 */
  var LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)
              || location.protocol === 'file:';

  /* 判断「我是不是就跑在那个带 /chat 的站点上」。
     pages.dev 是 Cloudflare 的默认域名；以后挂了自定义域名，
     把域名加进这个正则即可（例如 /(\.pages\.dev|^mnemo\.com)$/）。 */
  var HAS_OWN_CHAT = /\.pages\.dev$/i.test(location.hostname);

  /* ③ 用到的地址。以后换了自定义域名，只改这一行。 */
  var REMOTE_CHAT = 'https://mnemo-home.pages.dev/chat';

  var CFG = {
    MOCK: false,                              // ← 拿到 key、代理跑起来之后改成 false
    URL: LOCAL ? 'http://127.0.0.1:8787/chat'
       : (HAS_OWN_CHAT ? '/chat' : REMOTE_CHAT),
    /* 超时。这两个数是有故事的：原来是 6000 / 8000，结果每次调用都
       超时降级 —— 因为 v4 的思维链默认开着，一句「回个 ok」都要想六秒。
       代理那边已经把 thinking 关了，正常应该一两秒；这里放宽只是保险，
       正常情况下永远碰不到。 */
    TIMEOUT: 12000,             // 自由问答
    TIMEOUT_JSON: 15000,        // 抽信息 / 判意图 / 映射选项，要出 JSON

    /* 只在 MOCK 下有意义，用来演示各种情况 */
    MOCK_DELAY: [500, 1200],    // 假装在想，随机延迟区间
    MOCK_FAIL: 0,               // 0 = 从不失败；0.3 = 三成概率失败，用来看降级效果

    DEBUG: false                // true = 把模型每次原样返回的内容打进控制台
  };

  /* ── MNEMO 的人设。真接口和假应答器共用同一套口径 ────────── */
  var SYSTEM =
    'You are MNEMO, an assistant that adapts existing homes for older people. ' +
    'Answer in at most three sentences, plainly, no bullet points, no markdown. ' +
    'Be concrete: name the rules you work to — 1200 mm clear corridors, ' +
    'Ø1500 mm turning circles, no dead ends, a straight line from bed to bathroom. ' +
    'The three layouts on screen are fixed; never invent new measurements for this home. ' +
    'If asked something outside home adaptation, say briefly that it is not your area, ' +
    'then offer something you can help with. ' +
    'Be warm but not chatty — you are helping someone plan care for a person they love. ' +
    /* 原来这里写的是「跟随用户语言，对方打中文就回中文」。
       中文版已整体移除，站点是纯英文的 —— 这条要跟着改成写死英文，
       否则本地界面全英文、模型却用中文回，同一段对话里中英混排。
       （用户仍然可以用中文提问，只是 MNEMO 一律用英文回答。） */
    'IMPORTANT: always reply in English, whatever language the user writes in. ' +
    'Never mention that you are an AI model or which company made you — you are MNEMO.';

  /* ═══ 真接口 ═══════════════════════════════════════════════ */
  function callReal(messages, opts) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, opts.timeout);
    return fetch(CFG.URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: messages, json: !!opts.json }),
      signal: ctrl.signal
    })
      .then(function (r) {
        if (r.ok) return r.json();
        warn('代理返回 ' + r.status + '，看一眼代理那个黑窗口');
        return null;
      })
      .then(function (d) { return (d && d.text) ? d.text : null; })
      .catch(function (e) {                         // 断网 / 超时 / 500 / CORS，一律 null
        warn((e && e.name === 'AbortError')
          ? '超时了（' + opts.timeout + 'ms）—— 已按降级处理'
          : '连不上 ' + CFG.URL + '（' + (e && e.message) + '）');
        return null;
      })
      .then(function (v) { clearTimeout(timer); return v; });
  }

  /* 失败必须留痕。页面为了不吓着用户会安静地降级，
     但 F12 里得看得见 —— 不然"网页看起来正常"会被误读成"接口通了"。 */
  function warn(msg) {
    try { console.warn('%cMNEMO_LLM: ' + msg, 'color:#c0392b'); } catch (e) {}
  }

  /* 控制台里敲 MNEMO_LLM.cfg.DEBUG = true，之后每次调用都会
     把模型原样返回的东西打出来。判错了就是靠这个看是谁的问题：
     模型答错了，还是我接错了。 */
  var hook = null;          // bench() 用它把原样返回截下来
  function dbg(label, v) {
    if (hook) { try { hook(label, v); } catch (e) {} }
    if (!CFG.DEBUG) return;
    try { console.log('%cMNEMO_LLM · ' + label + ':', 'color:#2980b9', v); } catch (e) {}
  }

  /* 在 F12 控制台里敲 MNEMO_LLM.test() —— 一句话告诉你接口通没通 */
  function test() {
    if (CFG.MOCK) {
      console.log('%cMNEMO_LLM: 现在是 MOCK 模式，假应答器，根本没走网络。\n'
        + '把 assets/llm.js 第 22 行的 MOCK 改成 false，然后 Ctrl+F5。',
        'color:#b8860b;font-size:13px');
      return Promise.resolve({ mock: true });
    }
    var t0 = Date.now();
    console.log('%cMNEMO_LLM: 正在试 ' + CFG.URL + ' …', 'color:#888');
    return call([
      { role: 'system', content: 'Reply with exactly one word: ok' },
      { role: 'user', content: 'ping' }
    ], {}).then(function (t) {
      var ms = Date.now() - t0;
      if (t == null) {
        console.log('%cMNEMO_LLM: ✗ 没通。' + ms + 'ms 后没拿到内容。\n'
          + '按这个顺序查：代理窗口有没有新行 → 有没有报 401/402 → 地址端口对不对。',
          'color:#c0392b;font-size:13px');
        return { ok: false, ms: ms };
      }
      console.log('%cMNEMO_LLM: ✓ 通了。' + ms + 'ms，模型回：「' + t + '」',
        'color:#1e8449;font-size:13px');
      return { ok: true, ms: ms, text: t };
    });
  }

  /* ═══ 假应答器 ═════════════════════════════════════════════
     不是随便写几句占位。这里的回答是照着 MNEMO 该有的口径写的，
     换成真接口之后，system prompt 会把模型往同一个方向带。
     你现在看到的语气，大致就是上线后的语气。 */

  var FAQ = [
    /* ── 答题当中最常被打断问的几句。放在最前面，比下面的通用条目更具体 ── */
    { re: /\bage\b|年龄|多大|岁数/i,
      a: 'Age changes what I assume about reach and grip strength, and how much I weight the '
       + 'night route. It is not a filter — nobody gets excluded by a number. If you would '
       + 'rather not say, leave it blank and I will lean on the other answers.' },

    { re: /privacy|private|data|store|save|隐私|数据|保存|存在哪/i,
      a: 'What you type stays in this browser session. I am not building a file on anyone — '
       + 'the card on the right is the whole record, and it disappears when you close the tab.' },

    { re: /skip|rather not|不想说|跳过|不填/i,
      a: 'Say «skip» and I will leave it blank. A blank field simply carries less weight when I '
       + 'score the homes — nothing breaks, and you can come back to it.' },

    { re: /(?:why|what for).*(?:ask|question|need|want)|问这[些么]|为什么(?:要)?问|干(?:嘛|什么)/i,
      a: 'Every question here maps onto a measurement I can test a room against. Wheelchair '
       + 'indoors becomes a Ø1500 turning circle; night confusion pulls the bathroom onto a '
       + 'straight line from the bed. If I cannot test it, I do not ask it.' },

    { re: /fall|fell|trip(ped)?\b|摔|跌倒|绊/i,
      a: 'Most falls at home happen turning, reversing, or in the dark on the way to the '
       + 'bathroom. That is why I care about corridor width, turning circles and the night '
       + 'route more than about grab rails — the layout does the work before the fittings do.' },

    { re: /1200|corridor|走廊|通道|宽度/i,
      a: 'Twelve hundred millimetres is the point where a wheelchair and a standing person '
       + 'can pass each other without either backing up. Below that, someone always has to '
       + 'reverse — and reversing is where falls happen.' },

    { re: /1500|turn|turning|转[身圈弯]|回转/i,
      a: 'A Ø1500 mm circle is one full turn of a wheelchair on the spot. I check for one in '
       + 'the bathroom, one by the bed, and one at the kitchen. Without them the room is usable '
       + 'but not livable.' },

    { re: /dead.?end|死[端角]|loop|回路|一圈/i,
      a: 'A dead end forces a three-point turn in a narrow space. A loop lets someone keep '
       + 'walking forward and arrive back where they started — that matters most for the people '
       + 'who get disoriented on the way to the bathroom at night.' },

    { re: /why.*(option\s*c|c\b)|为什么.*(推荐|选).*c|c.*为什么/i,
      a: 'Option C keeps one continuous loop and the widest corridors of the three. For a cane '
       + 'user who tires quickly, that means no reversing and no doubling back. It scores lower '
       + 'on daylight than B — that is the trade.' },

    { re: /score|scoring|评分|分数|怎么算/i,
      a: 'Each layout is measured against the rules, not judged by taste. Day is how much of the '
       + 'floor gets direct light, Con is the tightest corridor, Vis is sight lines from the '
       + 'seating position, Air is cross-ventilation. Every number is a measurement.' },

    { re: /memory|dementia|forget|记忆|失智|健忘|认知/i,
      a: 'For memory, what decides the score is how many decisions a route asks for. Fewer '
       + 'junctions, rooms that can see into each other, and a loop instead of a branch. '
       + 'I keep the bathroom visible from the bed wherever the plan allows it.' },

    { re: /vision|sight|dark|glare|daylight|视力|眼|采光|光线|晚上|夜/i,
      a: 'For vision, I test the night route first — bed to bathroom, in the dark, without a '
       + 'light switch hunt. Then daylight depth: how far into the room usable light reaches at '
       + 'the worst hour of the year for this latitude.' },

    { re: /cost|price|budget|money|钱|预算|多少钱|造价/i,
      a: 'I do not price the work — that depends on your contractor and your building. What I '
       + 'can tell you is which walls I am asking you to move, and these three deliberately move '
       + 'as few as possible.' },

    { re: /change|different|other|另|别的|其他|换/i,
      a: 'These three are already the best of twenty-four. I can widen the search, but anything '
       + 'looser starts breaking the 1200 mm rule — and that rule is the one I would not bend.' },

    { re: /who are you|what are you|你是谁|你是什么/i,
      a: 'I am MNEMO. I read what you tell me about the person, then score homes we have '
       + 'surveyed against that — rather than showing you a catalogue and hoping one fits.' }
  ];

  /* ── 寒暄。假应答器也得会说人话，不然 MOCK 下看不出接完的效果 ──
     真接口不走这里 —— system prompt 里那句"跟随用户语言"会管。 */
  var GREET  = /^\s*(?:hi|hello|hey|yo|good\s*(?:morning|afternoon|evening)|你好呀?|您好|哈喽|哈啰|嗨|在吗|在么|有人吗)[\s!！,，.。?？~]*$/i;
  var THANKS = /^\s*(?:thanks?(?:\s*you)?|thx|cheers|谢谢你?|谢了|多谢|感谢)[\s!！,，.。~]*$/i;
  var BYE    = /^\s*(?:bye|goodbye|see\s*you|再见|拜拜|走了|下次聊)[\s!！,，.。~]*$/i;
  var OK     = /^\s*(?:ok(?:ay)?|sure|alright|got it|好的?|行|嗯+|知道了|明白)[\s!！,，.。~]*$/i;
  var UNSURE = /^\s*(?:i'?m not sure|not sure|i don'?t know|no idea|dunno|不知道|不太?确定|不清楚|说不好|不好说|没注意过)/i;

  function smallTalk(text) {
    if (GREET.test(text))
      return 'Hello. I am MNEMO — I adapt existing homes for older people, working to measured '
           + 'rules rather than taste. Interrupt me with questions whenever you like.';
    if (THANKS.test(text)) return 'You are welcome. Ask me anything as we go.';
    if (BYE.test(text))
      return 'Of course. What you have entered stays on this page — come back to it whenever.';
    if (OK.test(text))     return 'Good.';
    if (UNSURE.test(text))
      return 'That is fine. Leave it blank — say «skip» and I will move on. '
           + 'A blank field simply carries less weight when I score the homes.';
    return null;
  }

  function mockChat(text) {
    var s = smallTalk(text);
    if (s) return s;
    for (var i = 0; i < FAQ.length; i++) if (FAQ[i].re.test(text)) return FAQ[i].a;
    /* 兜不住的问题：老实说不知道，比编一个像样的答案安全。
       接上真接口之后这一支基本不会再出现 —— 模型什么都能接住。 */
    return 'I have noted that. I can speak to corridor widths, turning space, the night route '
         + 'and how I score these three layouts — ask me about any of those and I will be specific.';
  }

  /* ═══ 意图判定 ════════════════════════════════════════════
     答题当中打进来的一句话，可能是答案，也可能是搭话。
     关键在于：**判定和回复合成一次调用**。
     先判一次再答一次会翻倍延迟和花费，而模型判完之后本来就知道该回什么。 */
  function mockRoute(text, question) {
    if (smallTalk(text)) return { intent: 'chat', reply: mockChat(text) };
    if (/[?？]/.test(text)
        || /^(?:why|how|what|who|when|where|can|could|does|do|is|are|tell me|explain|i (?:just )?want to know)\b/i.test(text)
        || /为什么|为啥|什么意思|干嘛|干什么|凭什么|请问|我想问|想了解|了解一下|是怎么|怎么做|怎么弄|怎么算/.test(text)
        || /^(?:怎么|什么|谁|能不能|可以吗|是不是|你们|你能)/.test(text))
      return { intent: 'chat', reply: mockChat(text) };
    return { intent: 'answer', reply: null };
  }

  /* ═══ 抽姓名年龄 ═════════════════════════════════════════
     这里踩过一次坑，记下来：
     `My grandma Zhao Fang. She is 72 years old`
     —— 原来的实现只会剥中文称谓，英文的 "my grandma" 剥不掉，
     姓名抽空，调用方退回老正则，卡片上就出现了一整句话当名字。
     现在改成"多条模式依次试 + 最后统一过一遍合法性检查"。 */

  /* 称谓，中英文都要能剥 */
  var KIN_CN = /(?:我|我的|家里|老人家)?(?:奶奶|爷爷|外婆|外公|姥姥|姥爷|妈妈|爸爸|母亲|父亲|婆婆|公公|阿姨|叔叔|儿子|女儿|孙[子女]|外孙女?)/g;
  var KIN_EN = 'grand(?:ma|mother|pa|father|parent)|nan(?:a|ny)?|gran(?:ny)?|mum|mom|mother|dad|father|aunt(?:ie)?|uncle|neighbou?r';

  /* 这些词单独出现时不是名字。抽出 "She" / "The" 比抽不出更糟 ——
     抽不出还能追问一句，抽错了会被当成真的写进卡片。 */
  var NOT_NAME = /^(?:she|he|they|her|his|him|their|it|the|a|an|and|is|are|was|were|my|our|your|this|that|who|person|lady|man|woman|years?|old|name)$/i;
  /* 中文这边不是整词匹配，是"含有就否" —— `她今年80` 会抽出「今年」，
     它长度合法、没有数字，只能靠虚词表拦。 */
  var CN_STOP = /今年|岁数|多大|年纪|老人|自己|一个|生活|居住|独居|已经|现在|目前|退休|名字|叫做|奶奶|爷爷|外婆|外公|姥姥|姥爷|妈妈|爸爸|母亲|父亲|婆婆|公公|阿姨|叔叔/;

  function validName(s) {
    if (!s) return null;
    s = String(s).replace(/\s+/g, ' ').trim().replace(/^['"“”‘’]|['"“”‘’]$/g, '');
    if (!s || /\d/.test(s)) return null;
    if (s.length > 24) return null;
    if (CN_STOP.test(s)) return null;
    var w = s.split(' ');
    if (w.length > 3) return null;                              // 三个词以上，那是一句话
    if (w.every(function (x) { return NOT_NAME.test(x); })) return null;
    return s;
  }

  function mockExtract(text) {
    var out = { name: null, age: null };

    /* 年龄：优先"数字+岁 / years old"，退而求其次取任意 1–120 的数 */
    var m = text.match(/(\d{1,3})\s*(?:岁|years?\s*old|yo\b)/i)
         || text.match(/\b(\d{1,3})\b/);
    if (m) { var a = parseInt(m[1], 10); if (a >= 1 && a <= 120) out.age = a; }

    /* 姓名：五条模式，从最明确的往下试 */
    var pats = [
      /(?:name'?s?\s+is|named|called)\s+([A-Za-z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,   // name is Mei Li
      new RegExp('(?:' + KIN_EN + ")\\s*(?:'s)?\\s+([A-Z][a-z]+(?:\\s+[A-Z][a-z]+)?)", 'i'), // my grandma Zhao Fang
      /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*[,，]/,                                // Ying Zhang, 72
      /(?:叫做|叫|名字是|姓名)\s*([一-龥]{2,4})/,                                  // 叫张英
      /^([一-龥]{2,4})[，,]/                                                       // 张英，72
    ];
    for (var i = 0; i < pats.length && !out.name; i++) {
      var r = text.match(pats[i]);
      if (r) out.name = validName(r[1]);
    }

    /* 兜底 · 中文：剥掉称谓再取剩下的连续汉字 */
    if (!out.name) {
      var c = text.replace(KIN_CN, '')
                  .replace(/^[她他我你您它们的]+/, '')      // 剥掉句首代词
                  .replace(/^[，,、。\s]+/, '')            // 称谓剥完可能剩个逗号
                  .replace(/[，,。！!？?].*$/, '');
      /* 只在剩下很短时才敢用 —— 否则 `你们要这些信息干嘛`
         会被抽出「要这些信」当人名。跟英文那条兜底同一个道理。 */
      if ((c.match(/[一-龥]/g) || []).length <= 4) {
        var cn = c.match(/[一-龥]{2,4}/);
        if (cn) out.name = validName(cn[0]);
      }
    }

    /* 兜底 · 英文：剥掉句首称谓，取剩下的连续大写词。
       只在**剩下的很短**时才敢用 —— 否则
       `my grandmother, 85, she lives alone in Camden`
       会把地名 Camden 当成人名。这条兜底是给 `Zhao Fang` 这种
       只打了个名字的情况留的，不是用来解析整句话的。 */
    if (!out.name) {
      var en = text.replace(/[.。!！?？,，].*$/, '')
                   .replace(new RegExp('^\\s*(?:my|her|his|their|our)?\\s*(?:' + KIN_EN + ")\\s*(?:'s)?\\s*", 'i'), '')
                   .trim();
      if (en && en.split(/\s+/).length <= 3) {
        var ew = en.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/);
        if (ew) out.name = validName(ew[1]);
      }
    }

    return (out.name || out.age) ? out : null;
  }

  function callMock(messages, opts) {
    var last = messages[messages.length - 1].content;
    var lo = CFG.MOCK_DELAY[0], hi = CFG.MOCK_DELAY[1];
    var wait = lo + Math.random() * (hi - lo);
    return new Promise(function (resolve) {
      setTimeout(function () {
        if (Math.random() < CFG.MOCK_FAIL) return resolve(null);   // 演示降级
        if (opts.kind === 'route')   return resolve(JSON.stringify(mockRoute(last, opts.question)));
        if (opts.kind === 'extract') { var x = mockExtract(last); return resolve(x ? JSON.stringify(x) : null); }
        resolve(mockChat(last));
      }, wait);
    });
  }

  /* ═══ 开局探一次 ═══════════════════════════════════════════
     解决的是「能连但很慢」这种情况，它比彻底连不上更常见也更难受：
     下面 TIMEOUT 是 12 秒 / 15 秒，接口要是慢到超时，用户每打一句话
     都要干等十几秒才看到那句兜底回复 —— 比干脆没有 AI 还糟。

     所以页面一加载先打一个 GET 探路（几十字节，不调上游、不花钱）：
       探通了 → 照常走，后面每次调用都是真接口
       探不通 → reachable = false，之后所有调用**立刻**返回 null，
                一秒都不等，直接走各处写好的本地降级

     3.5 秒是拍的：Cloudflare 正常几十毫秒就回；超过三秒多半是
     跨境链路已经不行了，这时候早点认输比硬等强。

     ⚠ 只探一次，不重试。这一页的会话期内认这个结论 —— 中途好了也
     不会自动切回来，刷新一次即可。选择只探一次是因为：反复探测
     并不能让链路变快，只会让每次调用多一次往返。 */
  var reachable = null;          // null = 还没探完，true / false = 已有结论
  function probe() {
    if (CFG.MOCK || !CFG.URL) return;
    var ctl = null, timer = null;
    try {
      ctl = new AbortController();
      timer = setTimeout(function () { ctl.abort(); }, 3500);
    } catch (e) { return; }      // 太老的浏览器没有 AbortController，那就不探
    fetch(CFG.URL, { method: 'GET', signal: ctl.signal })
      .then(function (r) { reachable = !!r.ok; })
      .catch(function () { reachable = false; })
      .then(function () {
        clearTimeout(timer);
        if (!reachable) {
          warn('开局探测没通（' + CFG.URL + '）—— 本次会话不再尝试，'
             + '所有回答直接走本地降级，不会卡住输入框。');
        }
      });
  }
  probe();

  /* ═══ 统一入口 ═════════════════════════════════════════════ */
  function call(messages, opts) {
    opts = opts || {};
    opts.timeout = opts.timeout || (opts.json ? CFG.TIMEOUT_JSON : CFG.TIMEOUT);
    if (CFG.MOCK) return callMock(messages, opts);
    if (!CFG.URL) return Promise.resolve(null);      // 忘了填地址也不能崩
    if (reachable === false) return Promise.resolve(null);   // 探过了，不通，立刻降级
    return callReal(messages, opts);
  }

  /* 自由问答。ctx 是一句话的上下文（第几步、选了哪个户型…），
     让回答能贴着当前屏幕说，而不是泛泛而谈。 */
  function chat(text, ctx) {
    return call([
      { role: 'system', content: SYSTEM + (ctx ? '\n\nCurrent screen: ' + ctx : '') },
      { role: 'user', content: text }
    ], {});
  }

  /* 抽结构化信息。返回 {name, age} 或 null。
     注意 system prompt 里必须出现 "json" 这个词，这是 DeepSeek 的硬要求。 */
  function extract(text) {
    return call([
      { role: 'system', content:
          'Extract fields from the user message and reply with json only. ' +
          'Schema: {"name": string|null, "age": number|null, "gender": "Female"|"Male"|null}. ' +
          'Infer gender ONLY when the message makes it plain — a kinship word like ' +
          '"grandma" / "奶奶" / "grandfather", or a pronoun like she/her/he/his. ' +
          'If the message mentions people of both genders, or gives no clue, return null: ' +
          'a wrong guess here changes every sentence that follows. ' +
          'The name is the resident\'s OWN name, never a kinship word and never a ' +
          'fragment of the sentence. Strip "my grandmother" / "my nan" / "我奶奶" etc. ' +
          'Examples: ' +
          '"My grandma Zhao Fang. She is 72 years old" -> ' +
          '{"name":"Zhao Fang","age":72,"gender":"Female"}; ' +
          '"我奶奶张英，今年72" -> {"name":"张英","age":72,"gender":"Female"}; ' +
          '"She is 80 and lives alone" -> {"name":null,"age":80,"gender":"Female"}; ' +
          '"Zhang Wei, 68" -> {"name":"Zhang Wei","age":68,"gender":null}. ' +
          'If the name is not stated, return null for it — never return a pronoun, ' +
          'a kinship word, or a whole clause. Do not guess.' },
      { role: 'user', content: text }
    ], { json: true, kind: 'extract' }).then(function (t) {
      if (!t) return null;
      dbg('extract 原样返回', t);
      try {
        var o = JSON.parse(t);
        if (typeof o.age === 'string') o.age = parseInt(o.age, 10);
        if (!(o.age >= 1 && o.age <= 120)) o.age = null;
        if (typeof o.name !== 'string' || !o.name.trim()) o.name = null;
        if (o.gender !== 'Female' && o.gender !== 'Male') o.gender = null;
        return (o.name || o.age || o.gender) ? o : null;
      } catch (e) { return null; }
    });
  }

  /* ═══ route —— 答题当中那句话是答案还是搭话 ═══════════════
     返回 {intent:'answer'|'chat', reply:string|null}，或 null（失败）。
     判定和回复合成**一次**调用：模型判完之后本来就知道该回什么，
     再问第二次是白花钱和白等一秒。

     调用方拿到 null 时的兜底：当成答案处理。
     理由跟姓名那次一样 —— 把答案错当搭话，用户会以为流程卡住了；
     把搭话错当答案，他看得见、能重来。 */
  function route(text, question) {
    return call([
      { role: 'system', content:
          SYSTEM +
          '\n\nThe user is part-way through a questionnaire about the person who will live ' +
          'in the home. The question currently on screen is:\n"' + (question || '') + '"\n\n' +
          'Decide whether the user message is an ANSWER to that question, or something else — ' +
          'a greeting, small talk, a question back at you, a comment, an expression of worry. ' +
          'Reply with json only. Schema: {"intent":"answer"|"chat","reply":string|null}. ' +
          'If intent is "chat", write the reply yourself (at most three sentences, in English), ' +
          'answering them properly first, then inviting them back to the question ' +
          'without repeating it verbatim. If intent is "answer", set reply to null. ' +
          'When genuinely unsure, choose "answer".' },
      { role: 'user', content: text }
    ], { json: true, kind: 'route', question: question }).then(function (t) {
      if (!t) return null;
      dbg('route 原样返回', t);
      try {
        var o = JSON.parse(t);
        if (o.intent !== 'chat') return { intent: 'answer', reply: null };
        var r = (typeof o.reply === 'string' && o.reply.trim()) ? o.reply.trim() : null;
        return r ? { intent: 'chat', reply: r } : null;   // 说是闲聊却没给回复 → 当失败
      } catch (e) { return null; }
    });
  }

  /* ═══ pick —— 把一句自然语言映射成选项 ═══════════════════
     用在三条量表上（行动 / 视力 / 记忆）。这三题的权重决定 s2Track()，
     决定第 2 步给哪三个户型，决定整条流程 —— 所以这里的规矩是：

       **模型只负责"预选"，最终由用户点 Confirm 敲定。**

     绝不能拿模型的判断直接算分往下走。

     MOCK 下这个函数返回 null，让调用方走它自己那张关键词表 ——
     那张表就是断网时的兜底，正好借 MOCK 把它跑熟。 */
  function pick(text, question, options) {
    if (CFG.MOCK) return Promise.resolve(null);
    /* 让模型报**编号**，不要它复述选项文字。
       原来要它原样吐出选项字符串，它会改写 ——「Nobody」而不是
       「Lives alone」—— 于是对不回去，同一句话时灵时不灵。
       数字改不坏。 */
    var numbered = (options || []).map(function (o, i) { return i + '. ' + o; }).join('\n');
    return call([
      { role: 'system', content:
          'The user is answering a multiple-choice question in a questionnaire about an older '
        + 'person who will live in an adapted home.\n\n'
        + 'Question: "' + (question || '') + '"\n\n'
        + 'Options, by number:\n' + numbered + '\n\n'
        + 'Read the user message and reply with json only. '
        + 'Schema: {"picked": number[], "chat": string|null}.\n'
        + '"picked" holds the NUMBERS of every option the message describes — often more than '
        + 'one. Use numbers only, never the option text. Choose the closest option even when '
        + 'the user words it differently ("nobody" and "just her" both mean living alone; '
        + '"never" means the rarest option). If the message names a specific difficulty, do not '
        + 'also include a "no issues" option.\n'
        + 'If the message is not an answer at all — a greeting, a question back at you, small '
        + 'talk, an aside — set "picked" to [] and write a short reply in "chat", in English. '
        + 'Otherwise set "chat" to null.' },
      { role: 'user', content: text }
    ], { json: true, kind: 'pick' }).then(function (t) {
      if (!t) return null;
      dbg('pick 原样返回', t);
      try {
        var o = JSON.parse(t);
        var raw = Array.isArray(o.picked) ? o.picked : [];
        var picked = [];
        for (var i = 0; i < raw.length; i++) {
          var hit = matchOption(raw[i], options);
          if (hit) { if (picked.indexOf(hit) < 0) picked.push(hit); }
          else warn('模型给了一个不在选项里的值：' + JSON.stringify(raw[i]));
        }
        var chat = (typeof o.chat === 'string' && o.chat.trim()) ? o.chat.trim() : null;
        return { picked: picked, chat: chat };
      } catch (e) { warn('pick 返回的不是合法 json：' + String(t).slice(0, 120)); return null; }
    });
  }

  /* 把模型给的字符串对回选项。
     这里出过事：原来要求一字不差，模型回 "Rarely." 或者 "rarely"
     就整条被丢掉，然后调用方掉进本地关键词表 ——
     表里当时没有 "Never"，用户就看到了"对不上选项"。
     模型其实答对了，是我接得太死。 */
  function normOpt(s) {
    return String(s).toLowerCase()
      .replace(/[\s ]+/g, ' ')
      .replace(/[.,;:!?、，。；：！？'"“”‘’()（）\[\]]/g, '')
      .trim();
  }
  function wordIn(needle, hay) {
    if (!/[a-z0-9]/i.test(needle)) return hay.indexOf(needle) > -1;   // 中文没有词边界
    var esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(^|[^a-z0-9])' + esc + '([^a-z0-9]|$)', 'i').test(hay);
  }
  function matchOption(x, options) {
    if (!options) return null;

    /* 编号是正路。字符串那几条是退路 —— 模型偶尔还是会给文字。 */
    if (typeof x === 'number' || (typeof x === 'string' && /^\s*\d+\s*[.、)]?\s*$/.test(x))) {
      var n = parseInt(x, 10);
      return (n >= 0 && n < options.length) ? options[n] : null;
    }
    if (typeof x !== 'string') return null;

    var nx = normOpt(x.replace(/^\s*\d+\s*[.、)]\s*/, '')), i, no;   // "0. Lives alone"
    if (!nx) return null;
    for (i = 0; i < options.length; i++) if (normOpt(options[i]) === nx) return options[i];
    /* 整词包含。不能用裸 indexOf —— "female" 里含 "male"。 */
    for (i = 0; i < options.length; i++) {
      no = normOpt(options[i]);
      if (wordIn(nx, no) || wordIn(no, nx)) return options[i];
    }
    return null;
  }

  /* ═══ bench —— 拿真接口量一遍，别再靠猜 ═══════════════════
     控制台里敲 MNEMO_LLM.bench()。
     它会把十几句刁钻的说法真的发给模型，把**原样返回**和
     **解析结果**并排打出来。

     为什么要有它：「Nobody 对不上」这件事，可能是模型没听懂，
     也可能是它听懂了但我接丢了 —— 两种的修法完全相反。
     光看网页分不出来，只能看原样返回。
     大约十几次调用，几分钱。 */
  var BENCH = [
    { q: 'Who else is in the home?',
      o: ['Lives alone', 'With family', 'With a live-in carer'],
      cases: [['Nobody', 0], ['just her', 0], ['她一个人住', 0],
              ['lives with her son', 1], ['有个保姆', 2]] },
    { q: 'How often does she see her neighbours?',
      o: ['Most days', 'Weekly', 'Rarely'],
      cases: [['Never', 2], ['hardly ever', 2], ['偶尔', 2], ['每天都见', 0]] },
    { q: 'How does she get around indoors?',
      o: ['Walks unaided', 'Uses a cane', 'Uses a walking frame',
          'Unsteady when turning', 'Cannot manage steps', 'Wheelchair indoors'],
      cases: [['她转身的时候人会往一边倒', 3],
              ['She always need a cane and walking frame. She also need wheelchair indoor', 1],
              ["she doesn't use a wheelchair, she manages with a stick", 1],
              ['爬楼梯费劲', 4]] }
  ];

  function bench() {
    if (CFG.MOCK) {
      console.log('%cMNEMO_LLM.bench(): 现在是 MOCK 模式，量的是假应答器，没意义。\n'
        + '先把 MOCK 改成 false。', 'color:#b8860b;font-size:13px');
      return Promise.resolve(null);
    }
    var was = CFG.DEBUG; CFG.DEBUG = false;      // 自己打表，不要 dbg 插嘴
    var rows = [], jobs = [];
    BENCH.forEach(function (g) {
      g.cases.forEach(function (c) {
        jobs.push(function () {
          var raw = null, t0 = Date.now();
          var sniff = function (l, v) { if (l === 'pick 原样返回') raw = v; };
          hook = sniff;
          return pick(c[0], g.q, g.o).then(function (r) {
            hook = null;
            var got = (r && r.picked && r.picked.length) ? r.picked : [];
            rows.push({
              '输入': c[0].length > 34 ? c[0].slice(0, 32) + '…' : c[0],
              '模型原样返回': raw ? String(raw).replace(/\s+/g, ' ').slice(0, 46) : '(没拿到)',
              '解析成': got.join(' + ') || '(空)',
              '期望': g.o[c[1]],
              '对?': got.length === 1 && got[0] === g.o[c[1]] ? '✓'
                   : (got.indexOf(g.o[c[1]]) > -1 ? '≈' : '✗'),
              'ms': Date.now() - t0
            });
          });
        });
      });
    });

    console.log('%cMNEMO_LLM.bench(): 正在跑 ' + jobs.length + ' 条，稍等…', 'color:#888');
    return jobs.reduce(function (p, j) { return p.then(j); }, Promise.resolve())
      .then(function () {
        CFG.DEBUG = was;
        console.table(rows);
        var ok = rows.filter(function (r) { return r['对?'] !== '✗'; }).length;
        console.log('%c' + ok + ' / ' + rows.length + ' 条模型判对了。'
          + '\n✗ 那几行，看「模型原样返回」这一列：'
          + '\n  · 返回的是别的意思 → 模型没听懂，要改 prompt'
          + '\n  · 返回对了但「解析成」是空 → 是我接错了，要改代码',
          'color:#1e8449;font-size:13px');
        return rows;
      });
  }

  window.MNEMO_LLM = { cfg: CFG, chat: chat, extract: extract, route: route,
                       pick: pick, test: test, bench: bench };

  /* 打开页面就在控制台说一句自己是什么状态，省得猜 */
  try {
    console.log('%cMNEMO_LLM: ' + (CFG.MOCK ? 'MOCK 模式（假应答器，不走网络）'
                                            : '真接口 → ' + CFG.URL)
      + '   ·   敲 MNEMO_LLM.test() 可以当场验一下', 'color:#888');
  } catch (e) {}
})();
