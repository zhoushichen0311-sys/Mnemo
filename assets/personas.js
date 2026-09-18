/* ============================================================
   MNEMO · 三位老人的「一键填写」预设          2026-09-16
   ------------------------------------------------------------
   为什么有这个文件：
     三个版本（家属 / 医护 / 本人）的第 1 步都是十来格要填的信息。
     每演示一次就要从头敲一遍，老师看的是后面的平面和 3D，
     前面这几分钟纯属消耗。这里给三个现成的人，点一下全填上，
     **手填那条路一个字没动** —— 想自己填照样从第一问开始。

   为什么放在 assets/ 而不是各写一份：
     同一个人由家属填还是由医护填，结论必须一样（这是 carer-core.js
     里那条老规矩）。三份表分散在三个文件里，早晚会漂。
     这里只存**中性的 key**（'frame' / 'contrast' / 'lost'），
     每一版自己从 MAP 里取自己那一列的说法。

   ⚠️ 哪些是图上有的、哪些是我编的 —— 这条界线不能糊：
     【来自 persona 图】姓名的姓氏、年龄、独居、三档量表的勾选、
                        每个人那句 headline。
     【我编的】  名（Xiulan / Wei）、住哪个区、电话、紧急联系人、
                 房型、见邻居的频率、医护那一栏的记录人姓名团队。
                 编的理由：图上没有，而表单要填满才走得完流程。
                 电话用的是 Ofcom 留给影视剧的 07700 900xxx 段，
                 不会打到真人身上。
     【图上有但系统里没有对应字段】身高（158 / 163 / 174 cm）、
                 Level 几、各房间面积区间 —— 三版都没有这些格子，
                 所以没往里塞，也没为它们新开字段。
   ============================================================ */
(function (root) {
'use strict';

/* 三档量表的中性 key —— 顺序就是各版选项的顺序，别乱改：
   mob: unaided cane frame turning steps wheelchair
   vis: none night contrast print limited
   mem: none misplace colour lost                              */

var LIST = [
  {
    id:'mobility',
    /* 卡片上显示的两行 */
    tag:'Mobility',
    head:'Knee arthritis · balance loss',

    name:'Ying Zhang',  first:'Ying',  age:'69',
    gender:'Female',    pron:'She / her',
    area:'Camden',      lives:'Alone', home:'Ground-floor flat',
    nb:'Weekly',
    phone:'07700 900471',
    emg:'Mei, her daughter',

    /* 图里写的是：需要人扶着走、转身困难、起坐困难、够不到高处 */
    mob:['frame','turning'],
    vis:['none'],
    mem:['none'],
    primary:'mobility'
  },
  {
    id:'vision',
    tag:'Eyesight',
    head:'Low contrast · poor night vision',

    name:'Xiulan Li',   first:'Xiulan', age:'75',
    gender:'Female',    pron:'She / her',
    area:'Islington',   lives:'Alone',  home:'Flat, second floor with a lift',
    nb:'Rarely',
    phone:'07700 900318',
    emg:'Jun, her son',

    mob:['unaided'],
    vis:['contrast','night','print'],
    /* 图里那一行写着「Mild short-term memory decline」——
       勾了它三档里视力和记忆就并列（都是 3 分）。不改分数去凑，
       而是把「哪一项最要紧」直接答成视力：家属版和本人版本来
       就会追问这一句，医护版按 mobility→vision→memory 取第一个，
       结果也落在视力上。三版一致。 */
    mem:['misplace'],
    primary:'vision'
  },
  {
    id:'memory',
    tag:'Memory',
    head:'Short-term memory loss · disorientation',

    name:'Wei Chen',    first:'Wei',   age:'67',
    gender:'Male',      pron:'He / him',
    area:'Hackney',     lives:'Alone', home:'Terraced house',
    nb:'Most days',
    phone:'07700 900642',
    emg:'Hua, his son',

    mob:['unaided'],
    vis:['none'],
    /* 图里：忘记刚做过什么、忘记东西放哪、夜里困惑不安 */
    mem:['misplace','lost'],
    primary:'memory'
  }
];

/* 中性 key → 各版自己的说法。
   三列的文字必须和各版选项**逐字**一致，否则勾不上。
     family   = flow.html 的 S2_QA chips
     resident = flow-resident.html 的 Q1 opts
     carer    = carer-core.js 的 C.NEEDS 第一列（短标签） */
var MAP = {
  family: {
    mob:{ unaided:'Walks unaided', cane:'Uses a cane', frame:'Uses a walking frame',
          turning:'Unsteady when turning', steps:'Cannot manage steps',
          wheelchair:'Wheelchair indoors' },
    vis:{ none:'No issues', night:'Weaker at night', contrast:'Needs strong contrast',
          print:'Cannot read small print', limited:'Very limited vision' },
    mem:{ none:'No issues', misplace:'Forgets where things are',
          colour:'Needs colour cues', lost:'Gets disoriented at night' },
    /* 并列追问那一题的选项是 s2Tied() 给的轴名 */
    primary:{ mobility:'Mobility', vision:'Vision', memory:'Memory' },
    lives:{ Alone:'Lives alone' }
  },
  resident: {
    mob:{ unaided:'I walk unaided', cane:'I use a stick', frame:'I use a walking frame',
          turning:'I am unsteady when turning', steps:'I cannot manage steps',
          wheelchair:'A wheelchair indoors' },
    vis:{ none:'No trouble', night:'Worse at night', contrast:'I need strong contrast',
          print:'I can’t read small print', limited:'Very little sight' },
    mem:{ none:'No trouble', misplace:'I forget where things are',
          colour:'I need colour cues', lost:'I get disoriented at night' },
    /* 本人版追问那题用的是 AXIS_LABEL */
    primary:{ mobility:'Getting around', vision:'Eyesight', memory:'Memory' },
    lives:{ Alone:'I live alone' }
  },
  carer: {
    mob:{ unaided:'Unaided', cane:'Cane', frame:'Frame',
          turning:'Unsteady turning', steps:'No steps', wheelchair:'Wheelchair' },
    vis:{ none:'No issues', night:'Poor at night', contrast:'Needs contrast',
          print:'Small print', limited:'Very limited' },
    mem:{ none:'No issues', misplace:'Misplaces',
          colour:'Colour cues', lost:'Lost at night' },
    primary:{ mobility:'mobility', vision:'vision', memory:'memory' },
    lives:{ Alone:'Alone' }
  }
};

/* p = 某一位老人，flavour = 'family' | 'resident' | 'carer'，axis = 'mob'|'vis'|'mem'
   返回那一版认得的选项文字数组。 */
function words(p, flavour, axis){
  var col = MAP[flavour][axis];
  return (p[axis] || []).map(function(k){ return col[k]; })
                        .filter(function(x){ return !!x; });
}

/* 医护版那一栏「记录人」—— 也是编的，占位符里本来就写着这两个名字 */
var RECORDER = { carerName:'Alice McCain', carerRole:'Care worker',
                 carerTeam:'Elmfield Community Team' };

root.MNEMO_PERSONAS = { list:LIST, map:MAP, words:words, recorder:RECORDER };

})(window);
