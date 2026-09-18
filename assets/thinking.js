/* ============================================================
   MNEMO · 「正在分析」过渡的文案            2026-09-16
   ------------------------------------------------------------
   用在哪：用户选完户型、三个室内方案出现**之前**，
   就在那三张卡将要出现的框里放一段逐行推进的分析过程。

   为什么不是一个转圈：
     转圈只说明"在等"，说不出"在等什么"。这套系统真正在做的判断
     ——流线、净宽、对比度、决策点——本来就是这个项目的论点所在。
     把它逐行写出来，等待这几秒就从"卡住了"变成"它在替我想"。

   ⚠️ 老实话要说在前面：这一版的三个方案是**已经画好核过的**，
     这几行字是**过渡动画**，不是真的在跑计算。
     所以措辞一律用"正在分析 / 正在检查"这种过程描述，
     绝不写"已完成 / 通过 / 得分 87"这种会被当成真结果的话。
     真正算出来的东西在下一屏：那三张卡上的分数和规则，
     每一条都对得上 Figma 里那份稿子。

   五条通用 + 四条按分流。九行，每行约 850ms，整段约 8 秒。
   三个版本共用这一份 —— 文案散在三个文件里早晚会漂。
   ============================================================ */
(function (root) {
'use strict';

/* 五条通用：所有人都会看到的部分 */
var COMMON = [
  { en:'Analysing existing spatial conditions...', },
  { en:'Running visual connectivity analysis...', },
  { en:'Checking circulation and accessibility...', },
  { en:'Evaluating daylight and spatial visibility...', },
  { en:'Generating adaptive spatial configurations...', }
];

/* 四条按分流。写的是这一档**真正在意的那几件事** ——
   和 TRACK_COPY / S3_COPY 里那套说法对得上，不是另编一套词。
     mobility → 回转空间、可扶面、流线冲突
     vision   → 对比度、导向清晰度、触觉与照明引导
     memory   → 认知负荷、环形流线与尽端、决策点、颜色提示 */
var TRACK = {
  mobility: [
    { en:'Accounting for reduced mobility...', },
    { en:'Maintaining wheelchair turning clearance...', },
    { en:'Optimising continuous support surfaces...', },
    { en:'Reducing circulation conflicts...', }
  ],
  vision: [
    { en:'Accounting for reduced visual acuity...', },
    { en:'Evaluating visual contrast...', },
    { en:'Checking navigation clarity...', },
    { en:'Optimising tactile and lighting guidance...', }
  ],
  memory: [
    { en:'Accounting for cognitive load...', },
    { en:'Checking loop circulation and dead ends...', },
    { en:'Simplifying decision points...', },
    { en:'Aligning colour cues across rooms...', }
  ]
};

/* 节奏：每行 850ms，最后一行念完再停 700ms 才揭开三个方案。
   九行 × 850 + 700 ≈ 8.3 秒。改这两个数就能整体快慢。 */
var STEP = 850, HOLD = 700;

/* track 取不到就落回 mobility —— 和三个版本里所有别的兜底一致 */
function lines(track){
  return COMMON.concat(TRACK[track] || TRACK.mobility);
}
/* 取一行的文字。以前这里带一个 zh 参数（中文界面用），中文版已移除，
   为了不动三版里的调用点，多余的第二个实参留着也无害。 */
function text(row){ return row.en; }

/* 整段时长，给需要提前把按钮锁上的地方用 */
function total(track){ return lines(track).length * STEP + HOLD; }

root.MNEMO_THINKING = { common:COMMON, track:TRACK, lines:lines, text:text,
                        STEP:STEP, HOLD:HOLD, total:total };

})(window);
