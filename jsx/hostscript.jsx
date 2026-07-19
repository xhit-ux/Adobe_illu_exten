// hostscript.jsx
// CEP 只加载这一个稳定入口。ExtendScript 在编译期展开各功能模块，
// 确保模块中的函数位于 csInterface.evalScript 可访问的全局作用域。
#include "modules/document.jsx"
#include "modules/dxf-import.jsx"
#include "modules/dxf-parser.jsx"
#include "modules/dxf-geometry.jsx"
#include "modules/dxf-drawing.jsx"
#include "modules/notches.jsx"
#include "modules/styles.jsx"
#include "modules/anchors-size-tags.jsx"
#include "modules/inheritance.jsx"
#include "modules/size-labels.jsx"
#include "modules/pattern-layout.jsx"
