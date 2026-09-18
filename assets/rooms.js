/* ============================================================
   MNEMO · 27 个 3D 房间页的地址表           2026-09-16
   ------------------------------------------------------------
   key 是「分流-户型-方案」三段，和三个流程页里的 PV_PAGE 一字不差。

   为什么要单独开一份：
     两个档案页（home-file.html / home-file-resident.html）上那个
     「Open in 3D」「Look at it in 3D」原来是**裸 button，没绑任何事件**
     —— 点了什么都不发生。要让它们跳得对，就得知道房间页叫什么名字。
     再在档案页里各抄一份 PV_PAGE，这张表就有五份，早晚漂。

   ⚠️ mobility 那九条的文件名是历史写法（**没有 mobility- 前缀**），
     别为了整齐去改名 —— 文件真就叫那个名字。

   现状说明：flow.html / flow-resident.html / flow-carer-4.html 里
     各有一份一模一样的 PV_PAGE，这一版没动它们（那三处都在跑，
     改了要重测 27 个房间）。哪天要收口，把那三处换成这个文件即可。
   ============================================================ */
(function (root) {
'use strict';

var PAGE = {
  'mobility-A-A':'preview-3d-optionA.html',
  'mobility-A-B':'preview-3d-optionB.html',
  'mobility-A-C':'preview-3d.html',
  'mobility-B-A':'preview-3d-typeB-optionA.html',
  'mobility-B-B':'preview-3d-typeB-optionB.html',
  'mobility-B-C':'preview-3d-typeB-optionC.html',
  'mobility-C-A':'preview-3d-typeC-optionA.html',
  'mobility-C-B':'preview-3d-typeC-optionB.html',
  'mobility-C-C':'preview-3d-typeC-optionC.html',
  'vision-A-A':'preview-3d-vision-typeA-optionA.html',
  'vision-A-B':'preview-3d-vision-typeA-optionB.html',
  'vision-A-C':'preview-3d-vision-typeA-optionC.html',
  'vision-B-A':'preview-3d-vision-typeB-optionA.html',
  'vision-B-B':'preview-3d-vision-typeB-optionB.html',
  'vision-B-C':'preview-3d-vision-typeB-optionC.html',
  'vision-C-A':'preview-3d-vision-typeC-optionA.html',
  'vision-C-B':'preview-3d-vision-typeC-optionB.html',
  'vision-C-C':'preview-3d-vision-typeC-optionC.html',
  'memory-A-A':'preview-3d-memory-typeA-optionA.html',
  'memory-A-B':'preview-3d-memory-typeA-optionB.html',
  'memory-A-C':'preview-3d-memory-typeA-optionC.html',
  'memory-B-A':'preview-3d-memory-typeB-optionA.html',
  'memory-B-B':'preview-3d-memory-typeB-optionB.html',
  'memory-B-C':'preview-3d-memory-typeB-optionC.html',
  'memory-C-A':'preview-3d-memory-typeC-optionA.html',
  'memory-C-B':'preview-3d-memory-typeC-optionB.html',
  'memory-C-C':'preview-3d-memory-typeC-optionC.html'
};

/* 查不到返回空串 —— 调用方据此把按钮藏起来，而不是跳去一个 404。
   "有个按钮点了 404" 比 "没有那个按钮" 糟得多。 */
function page(track, type, opt){
  var k = String(track || 'mobility').toLowerCase() + '-'
        + String(type  || 'A').toUpperCase() + '-'
        + String(opt   || 'C').toUpperCase();
  return PAGE[k] || '';
}

root.MNEMO_ROOMS = { PAGE:PAGE, page:page };

})(window);
