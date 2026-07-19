
var outDir = Folder("C:/Users/34164/AppData/Roaming/Adobe/CEP/extensions/Hello_world/generated");
if (!outDir.exists) outDir.create();

var PT_PER_CM = 28.3464566929;
var PT_PER_MM = 2.83464566929;
var BLEED = 3 * PT_PER_MM;
var BLUE = [100, 85, 25, 25];
var GOLD = [0, 16, 100, 0];
var WHITE = [0, 0, 0, 0];
var BLACK = [0, 0, 0, 100];
var CUT = [0, 0, 0, 100];
var SEW = [0, 0, 0, 55];
var RED = [0, 90, 80, 0];

function cmyk(v) {
  var c = new CMYKColor();
  c.cyan = v[0]; c.magenta = v[1]; c.yellow = v[2]; c.black = v[3];
  return c;
}

function noColor() {
  return new NoColor();
}

function setStroke(item, col, width, dashed) {
  item.stroked = true;
  item.strokeColor = cmyk(col);
  item.strokeWidth = width;
  if (dashed) item.strokeDashes = [8, 5];
}

function setFill(item, col) {
  item.filled = true;
  item.fillColor = cmyk(col);
}

function rect(layer, name, left, top, w, h, fill, stroke, sw, dash) {
  var p = layer.pathItems.rectangle(top, left, w, h);
  p.name = name;
  if (fill) setFill(p, fill); else p.filled = false;
  if (stroke) setStroke(p, stroke, sw || 1, dash); else p.stroked = false;
  return p;
}

function ellipse(layer, name, left, top, w, h, fill, stroke, sw) {
  var p = layer.pathItems.ellipse(top, left, w, h);
  p.name = name;
  if (fill) setFill(p, fill); else p.filled = false;
  if (stroke) setStroke(p, stroke, sw || 1, false); else p.stroked = false;
  return p;
}

function path(layer, name, pts, fill, stroke, sw, closed, dash) {
  var p = layer.pathItems.add();
  p.name = name;
  p.setEntirePath(pts);
  p.closed = closed !== false;
  if (fill) setFill(p, fill); else p.filled = false;
  if (stroke) setStroke(p, stroke, sw || 1, dash); else p.stroked = false;
  return p;
}

function makeText(layer, label, x, y, size, col) {
  var t = layer.textFrames.add();
  t.contents = label;
  t.left = x;
  t.top = y;
  t.textRange.characterAttributes.size = size;
  t.textRange.characterAttributes.fillColor = cmyk(col || BLACK);
  t.name = label;
  try {
    var outlined = t.createOutline();
    outlined.name = "Outlined_" + label;
    return outlined;
  } catch (e) {
    t.name = "Text_" + label;
    return t;
  }
}

function centerText(layer, label, x, y, size, col) {
  var g = makeText(layer, label, x, y, size, col);
  try { g.left = x - g.width / 2; } catch (e) {}
  return g;
}

function line(layer, name, x1, y1, x2, y2, col, sw, dash) {
  return path(layer, name, [[x1, y1], [x2, y2]], null, col, sw || 1, false, dash);
}

function arrow(layer, name, x, y1, y2) {
  line(layer, name + "_Shaft", x, y1, x, y2, BLACK, 1, false);
  path(layer, name + "_Head", [[x - 6, y2 + 12], [x, y2], [x + 6, y2 + 12]], BLACK, BLACK, 1, true, false);
}

function notch(layer, name, x, y, angle) {
  var s = 10;
  if (angle === "h") line(layer, name, x - s, y, x + s, y, RED, 1.5, false);
  else line(layer, name, x, y - s, x, y + s, RED, 1.5, false);
}

function duplicateToLayer(item, layer, name) {
  var d = item.duplicate(layer, ElementPlacement.PLACEATEND);
  if (name) d.name = name;
  return d;
}

function createLogoFile() {
  var size = 20 * PT_PER_CM;
  var doc = app.documents.add(DocumentColorSpace.CMYK, size + 2 * BLEED, size + 2 * BLEED, 2);
  doc.rulerUnits = RulerUnits.Centimeters;
  doc.artboards[0].artboardRect = [0, size + 2 * BLEED, size + 2 * BLEED, 0];
  doc.artboards[0].name = "Transparent_BG_20cm";
  doc.artboards[1].artboardRect = [size + 3 * PT_PER_CM, size + 2 * BLEED, size + 3 * PT_PER_CM + size + 2 * BLEED, 0];
  doc.artboards[1].name = "White_BG_20cm";

  var bg = doc.layers.add(); bg.name = "White_Background";
  var bleed = doc.layers.add(); bleed.name = "BleedGuide";
  var outline = doc.layers.add(); outline.name = "Logo_Outline";
  var fill = doc.layers.add(); fill.name = "Logo_Fill";

  var origins = [BLEED, size + 3 * PT_PER_CM + BLEED];
  for (var oi = 0; oi < origins.length; oi++) {
    var ox = origins[oi], oy = BLEED;
    if (oi === 1) rect(bg, "White_Background", ox - BLEED, size + BLEED, size + 2 * BLEED, size + 2 * BLEED, WHITE, null);
    rect(bleed, "Bleed_3mm", ox - BLEED, size + BLEED, size + 2 * BLEED, size + 2 * BLEED, null, RED, 0.5, true);
    rect(bleed, "Trim_20cm", ox, size, size, size, null, BLACK, 0.4, false);

    ellipse(fill, "DeepBlue_Badge", ox + 1.2 * PT_PER_CM, size - 1.2 * PT_PER_CM, 17.6 * PT_PER_CM, 17.6 * PT_PER_CM, BLUE, null);
    ellipse(fill, "Gold_Inner_Ring", ox + 2.3 * PT_PER_CM, size - 2.3 * PT_PER_CM, 15.4 * PT_PER_CM, 15.4 * PT_PER_CM, null, GOLD, 12);

    var cx = ox + 10 * PT_PER_CM;
    var top = size - 4.7 * PT_PER_CM;
    path(fill, "Cat_Head", [
      [cx - 4.2 * PT_PER_CM, top - 3.0 * PT_PER_CM],
      [cx - 3.2 * PT_PER_CM, top + 1.2 * PT_PER_CM],
      [cx - 1.1 * PT_PER_CM, top - 0.4 * PT_PER_CM],
      [cx + 1.1 * PT_PER_CM, top - 0.4 * PT_PER_CM],
      [cx + 3.2 * PT_PER_CM, top + 1.2 * PT_PER_CM],
      [cx + 4.2 * PT_PER_CM, top - 3.0 * PT_PER_CM],
      [cx + 3.2 * PT_PER_CM, top - 6.0 * PT_PER_CM],
      [cx, top - 7.3 * PT_PER_CM],
      [cx - 3.2 * PT_PER_CM, top - 6.0 * PT_PER_CM]
    ], GOLD, null, 1, true, false);

    ellipse(fill, "Cat_Left_Eye", cx - 2.15 * PT_PER_CM, top - 2.35 * PT_PER_CM, 0.85 * PT_PER_CM, 0.65 * PT_PER_CM, BLUE, null);
    ellipse(fill, "Cat_Right_Eye", cx + 1.3 * PT_PER_CM, top - 2.35 * PT_PER_CM, 0.85 * PT_PER_CM, 0.65 * PT_PER_CM, BLUE, null);
    path(fill, "Cat_Nose", [[cx - 0.35 * PT_PER_CM, top - 3.25 * PT_PER_CM], [cx + 0.35 * PT_PER_CM, top - 3.25 * PT_PER_CM], [cx, top - 3.75 * PT_PER_CM]], BLUE, null, 1, true, false);
    line(outline, "Cat_Mouth_Left", cx, top - 3.78 * PT_PER_CM, cx - 0.8 * PT_PER_CM, top - 4.35 * PT_PER_CM, BLUE, 2.4, false);
    line(outline, "Cat_Mouth_Right", cx, top - 3.78 * PT_PER_CM, cx + 0.8 * PT_PER_CM, top - 4.35 * PT_PER_CM, BLUE, 2.4, false);
    for (var w = 0; w < 3; w++) {
      var yy = top - (3.35 + w * 0.55) * PT_PER_CM;
      line(outline, "Whisker_L_" + w, cx - 1.0 * PT_PER_CM, yy, cx - (3.0 + w * 0.25) * PT_PER_CM, yy + (1 - w) * 5, BLUE, 2.2, false);
      line(outline, "Whisker_R_" + w, cx + 1.0 * PT_PER_CM, yy, cx + (3.0 + w * 0.25) * PT_PER_CM, yy + (1 - w) * 5, BLUE, 2.2, false);
    }
    centerText(fill, "CAT TEAM", cx, size - 15.4 * PT_PER_CM, 28, GOLD);
    centerText(fill, "PRINT LOGO", cx, size - 17.0 * PT_PER_CM, 14, GOLD);
  }

  var aiFile = File(outDir.fsName + "/cat_logo_print_20cm_cmyk.ai");
  var pdfFile = File(outDir.fsName + "/cat_logo_print_20cm_cmyk.pdf");
  doc.saveAs(aiFile);
  var pdfOptions = new PDFSaveOptions();
  pdfOptions.preserveEditability = true;
  doc.saveAs(pdfFile, pdfOptions);
  doc.close(SaveOptions.DONOTSAVECHANGES);
}

function addPatternPiece(layer, labelLayer, cutLayer, sewLayer, markLayer, label, x, y, w, h, waistInset, neckDrop, armDrop) {
  var pts = [
    [x + waistInset, y],
    [x + w - waistInset, y],
    [x + w - waistInset * 0.55, y - h * 0.52],
    [x + w * 0.73, y - h + armDrop],
    [x + w * 0.58, y - h + neckDrop],
    [x + w * 0.42, y - h + neckDrop],
    [x + w * 0.27, y - h + armDrop],
    [x + waistInset * 0.55, y - h * 0.52]
  ];
  path(cutLayer, label + "_CutLine", pts, null, CUT, 1.2, true, false);
  path(sewLayer, label + "_SewLine_1cm", [
    [x + waistInset + 10, y - 10],
    [x + w - waistInset - 10, y - 10],
    [x + w - waistInset * 0.55 - 10, y - h * 0.52],
    [x + w * 0.73 - 10, y - h + armDrop - 5],
    [x + w * 0.58, y - h + neckDrop + 10],
    [x + w * 0.42, y - h + neckDrop + 10],
    [x + w * 0.27 + 10, y - h + armDrop - 5],
    [x + waistInset * 0.55 + 10, y - h * 0.52]
  ], null, SEW, 0.8, true, true);
  arrow(markLayer, label + "_Grain", x + w / 2, y - h * 0.18, y - h * 0.76);
  notch(markLayer, label + "_Arm_Notch_L", x + w * 0.27, y - h + armDrop, "h");
  notch(markLayer, label + "_Arm_Notch_R", x + w * 0.73, y - h + armDrop, "h");
  notch(markLayer, label + "_Side_Notch_L", x + waistInset * 0.55, y - h * 0.52, "v");
  notch(markLayer, label + "_Side_Notch_R", x + w - waistInset * 0.55, y - h * 0.52, "v");
  centerText(labelLayer, label, x + w / 2, y - h * 0.44, 13, BLACK);
}

function addRectPiece(labelLayer, cutLayer, sewLayer, markLayer, label, x, y, w, h, grainVertical) {
  rect(cutLayer, label + "_CutLine", x, y, w, h, null, CUT, 1.2, false);
  rect(sewLayer, label + "_SewLine_1cm", x + 10, y - 10, w - 20, h - 20, null, SEW, 0.8, true);
  if (grainVertical) arrow(markLayer, label + "_Grain", x + w / 2, y - h * 0.2, y - h * 0.8);
  else {
    line(markLayer, label + "_Grain_Shaft", x + w * 0.18, y - h / 2, x + w * 0.82, y - h / 2, BLACK, 1, false);
    path(markLayer, label + "_Grain_Head", [[x + w * 0.82, y - h / 2], [x + w * 0.78, y - h / 2 + 6], [x + w * 0.78, y - h / 2 - 6]], BLACK, BLACK, 1, true, false);
  }
  centerText(labelLayer, label, x + w / 2, y - h / 2 + 8, 10, BLACK);
  notch(markLayer, label + "_Notch_A", x + w / 2, y, "v");
}

function addShortsPiece(labelLayer, cutLayer, sewLayer, markLayer, label, x, y, w, h, front) {
  var crotch = front ? 0.72 : 0.78;
  var pts = [
    [x + w * 0.12, y],
    [x + w * 0.9, y],
    [x + w, y - h],
    [x + w * 0.58, y - h],
    [x + w * crotch, y - h * 0.46],
    [x + w * 0.38, y - h],
    [x, y - h]
  ];
  path(cutLayer, label + "_CutLine", pts, null, CUT, 1.2, true, false);
  path(sewLayer, label + "_SewLine_1cm", [
    [x + w * 0.12 + 10, y - 10],
    [x + w * 0.9 - 10, y - 10],
    [x + w - 10, y - h + 10],
    [x + w * 0.58, y - h + 10],
    [x + w * crotch - 8, y - h * 0.46],
    [x + w * 0.38, y - h + 10],
    [x + 10, y - h + 10]
  ], null, SEW, 0.8, true, true);
  arrow(markLayer, label + "_Grain", x + w * 0.5, y - h * 0.2, y - h * 0.82);
  notch(markLayer, label + "_Side_Notch", x + w * 0.9, y - h * 0.42, "v");
  notch(markLayer, label + "_Crotch_Notch", x + w * crotch, y - h * 0.46, "h");
  centerText(labelLayer, label, x + w / 2, y - h * 0.45, 11, BLACK);
}

function createPatternFile() {
  var aw = 160 * PT_PER_CM;
  var ah = 110 * PT_PER_CM;
  var doc = app.documents.add(DocumentColorSpace.CMYK, aw, ah, 4);
  doc.rulerUnits = RulerUnits.Centimeters;
  var labels = doc.layers.add(); labels.name = "PieceLabels_Outlined";
  var marks = doc.layers.add(); marks.name = "Grain_Notches";
  var sew = doc.layers.add(); sew.name = "SewLine_Dashed";
  var cut = doc.layers.add(); cut.name = "CutLine_Solid";
  var guide = doc.layers.add(); guide.name = "ArtboardGuide";

  var sizes = [
    {n:"S", chest:50, length:72, shoulder:34, shortW:34, shortH:48},
    {n:"M", chest:52, length:74, shoulder:36, shortW:36, shortH:50},
    {n:"L", chest:55, length:77, shoulder:38, shortW:38, shortH:52},
    {n:"XL", chest:58, length:80, shoulder:40, shortW:40, shortH:54}
  ];

  for (var i = 0; i < sizes.length; i++) {
    var s = sizes[i];
    var ax = i * (aw + 3 * PT_PER_CM);
    doc.artboards[i].artboardRect = [ax, ah, ax + aw, 0];
    doc.artboards[i].name = s.n + "码";
    rect(guide, s.n + "_Artboard_1to1", ax + PT_PER_CM, ah - PT_PER_CM, aw - 2 * PT_PER_CM, ah - 2 * PT_PER_CM, null, RED, 0.6, true);
    makeText(labels, "Basketball Jersey + Shorts Pattern " + s.n + "  1:1  seam allowance 1cm", ax + 2 * PT_PER_CM, ah - 2 * PT_PER_CM, 16, BLACK);

    var frontW = s.chest * PT_PER_CM;
    var bodyH = s.length * PT_PER_CM;
    var x1 = ax + 5 * PT_PER_CM;
    var y1 = ah - 8 * PT_PER_CM;
    addPatternPiece(null, labels, cut, sew, marks, "Front_Body_" + s.n, x1, y1, frontW, bodyH, 3 * PT_PER_CM, 11 * PT_PER_CM, 24 * PT_PER_CM);
    addPatternPiece(null, labels, cut, sew, marks, "Back_Body_" + s.n, x1 + 58 * PT_PER_CM, y1, frontW, bodyH, 3 * PT_PER_CM, 5 * PT_PER_CM, 23 * PT_PER_CM);

    addRectPiece(labels, cut, sew, marks, "Side_Panel_" + s.n, ax + 116 * PT_PER_CM, y1, 10 * PT_PER_CM, (s.length - 8) * PT_PER_CM, true);
    addRectPiece(labels, cut, sew, marks, "Neckline_Binding_" + s.n, ax + 130 * PT_PER_CM, y1, 5 * PT_PER_CM, 42 * PT_PER_CM, false);
    addRectPiece(labels, cut, sew, marks, "Armhole_Binding_" + s.n + "_Pair", ax + 139 * PT_PER_CM, y1, 5 * PT_PER_CM, 54 * PT_PER_CM, false);
    addRectPiece(labels, cut, sew, marks, "Hem_" + s.n, ax + 148 * PT_PER_CM, y1, 6 * PT_PER_CM, (s.chest * 2 + 8) * PT_PER_CM, false);

    var sy = ah - 83 * PT_PER_CM;
    addShortsPiece(labels, cut, sew, marks, "Shorts_Front_" + s.n, ax + 5 * PT_PER_CM, sy, s.shortW * PT_PER_CM, s.shortH * PT_PER_CM, true);
    addShortsPiece(labels, cut, sew, marks, "Shorts_Back_" + s.n, ax + 44 * PT_PER_CM, sy, (s.shortW + 4) * PT_PER_CM, (s.shortH + 2) * PT_PER_CM, false);
    addRectPiece(labels, cut, sew, marks, "Waistband_" + s.n, ax + 88 * PT_PER_CM, sy, 10 * PT_PER_CM, (s.chest * 2) * PT_PER_CM, false);
    addRectPiece(labels, cut, sew, marks, "Shorts_Side_Stripe_" + s.n + "_Pair", ax + 103 * PT_PER_CM, sy, 8 * PT_PER_CM, s.shortH * PT_PER_CM, true);
  }

  var aiFile = File(outDir.fsName + "/basketball_uniform_pattern_S-M-L-XL_1to1.ai");
  var pdfFile = File(outDir.fsName + "/basketball_uniform_pattern_S-M-L-XL_1to1.pdf");
  doc.saveAs(aiFile);
  var pdfOptions = new PDFSaveOptions();
  pdfOptions.preserveEditability = true;
  doc.saveAs(pdfFile, pdfOptions);
  doc.close(SaveOptions.DONOTSAVECHANGES);
}

app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
createLogoFile();
createPatternFile();
alert("已生成：cat_logo_print_20cm_cmyk.ai / basketball_uniform_pattern_S-M-L-XL_1to1.ai");
