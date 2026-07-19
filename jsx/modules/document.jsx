// 文档扫描、文档单位与比例工具

var LANTU_DXF_UNIT_CACHE = {
    document: null,
    scaleFactor: 1
};

function identifyPatternPieces() {
    try {
        invalidateDxfAnchorOptionsCache();
        if (app.documents.length === 0) {
            return "请先在 Illustrator 中打开裁片文件！";
        }

        var doc = app.activeDocument;
        var layer = doc.activeLayer;
        var allGroups = layer.groupItems;
        var topGroups = [];
        var reportLines = [];

        // layer.groupItems 可能包含嵌套编组，只保留当前图层直属的顶层编组。
        for (var i = 0; i < allGroups.length; i++) {
            var group = allGroups[i];
            if (group.parent === layer) {
                topGroups.push(group);
            }
        }

        function collectImportedPieceGroups(container, result) {
            if (container.note && container.note.indexOf("AAMA_PIECE|") === 0) {
                result.push(container);
                return;
            }
            for (var i = 0; i < container.groupItems.length; i++) {
                if (container.groupItems[i].parent === container) {
                    collectImportedPieceGroups(container.groupItems[i], result);
                }
            }
        }

        var importedPieceGroups = [];
        for (var topIndex = 0; topIndex < topGroups.length; topIndex++) {
            if (topGroups[topIndex].note && topGroups[topIndex].note.indexOf("AAMA_SIZE|") === 0) {
                collectImportedPieceGroups(topGroups[topIndex], importedPieceGroups);
            }
        }
        if (importedPieceGroups.length > 0) {
            topGroups = importedPieceGroups;
        }

        function addUnique(list, value) {
            for (var i = 0; i < list.length; i++) {
                if (list[i] === value) {
                    return;
                }
            }
            list.push(value);
        }

        function extractSizes(text, result) {
            if (text === undefined || text === null || text === "") {
                return;
            }

            // 用非字母数字字符切分，兼容“尺码: 3XL”、“3XL 3XL”等不规范文本。
            var tokens = String(text).toUpperCase().split(/[^A-Z0-9]+/);
            var sizeRegex = /^(?:[2-9]XL|X{1,4}[SML]|[SML])$/;

            for (var i = 0; i < tokens.length; i++) {
                if (sizeRegex.test(tokens[i])) {
                    addUnique(result, tokens[i]);
                }
            }
        }

        function collectPieceSizes(item, result) {
            // 图层面板显示的文字可能来自对象名，也可能来自文字对象的 contents。
            extractSizes(item.name, result);

            if (item.typename === "TextFrame") {
                extractSizes(item.contents, result);
            }

            if (item.typename === "GroupItem") {
                for (var i = 0; i < item.pageItems.length; i++) {
                    collectPieceSizes(item.pageItems[i], result);
                }
            }
        }

        function checkIfHasClippingMask(item) {
            if (item.typename !== "GroupItem") {
                return false;
            }

            if (item.clipped === true) {
                return true;
            }

            for (var i = 0; i < item.pageItems.length; i++) {
                if (checkIfHasClippingMask(item.pageItems[i])) {
                    return true;
                }
            }
            return false;
        }

        var totalQuantity = 0;
        for (var j = 0; j < topGroups.length; j++) {
            var topGroup = topGroups[j];
            var sizes = [];
            var pieceQuantity = getAamaPieceQuantityFromNote(topGroup.note);
            totalQuantity += pieceQuantity;

            collectPieceSizes(topGroup, sizes);

            var pieceSize = sizes.length > 0 ? sizes.join("、") : "未知尺码";
            var hasClippingMask = checkIfHasClippingMask(topGroup);

            $.writeln("裁片 " + (j + 1) + "，尺码: " + pieceSize);
            reportLines.push(
                "裁片 " + (j + 1) +
                " -> [尺码: " + pieceSize + "]" +
                " | 数量: " + pieceQuantity +
                " | 包含图案: " + (hasClippingMask ? "是" : "否")
            );
        }

        var finalResult = "扫描完成！识别到 " + topGroups.length + " 个裁片几何编组，" +
            "按 Quantity 合计 " + totalQuantity + " 片：\n" +
            "-----------------------------------\n" +
            reportLines.join("\n");

        return finalResult;
    } catch (error) {
        return "执行报错: " + error.message + "（行号: " + error.line + "）";
    }
}

function getDxfDocumentFromItem(item) {
    var current = item;
    var guard = 0;
    while (current && guard < 30) {
        if (current.typename === "Document") {
            return current;
        }
        current = current.parent;
        guard++;
    }
    if (typeof app !== "undefined" && app.documents.length > 0) {
        return app.activeDocument;
    }
    return null;
}

function getDxfDocumentScaleFactor(documentOrItem) {
    var doc = documentOrItem && documentOrItem.typename === "Document" ?
        documentOrItem : null;
    if (doc === null && typeof app !== "undefined" && app.documents.length > 0) {
        // 插件所有绘制都发生在活动文档，避免每条路径从 GroupItem 逐级向上
        // 查找 Document。超大 DXF 中这会减少数万次 Illustrator DOM 访问。
        doc = app.activeDocument;
    }
    if (doc === null) {
        doc = getDxfDocumentFromItem(documentOrItem);
    }
    if (doc !== null && LANTU_DXF_UNIT_CACHE.document === doc) {
        return LANTU_DXF_UNIT_CACHE.scaleFactor;
    }
    var scaleFactor = 1;
    if (doc !== null) {
        try {
            scaleFactor = parseFloat(doc.scaleFactor);
        } catch (scaleError) {
            scaleFactor = 1;
        }
    }
    scaleFactor = !isNaN(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
    LANTU_DXF_UNIT_CACHE.document = doc;
    LANTU_DXF_UNIT_CACHE.scaleFactor = scaleFactor;
    return scaleFactor;
}

function getDxfMillimeterToDocumentUnits(documentOrItem) {
    return (72 / 25.4) / getDxfDocumentScaleFactor(documentOrItem);
}

function getDxfPointToDocumentUnits(documentOrItem) {
    return 1 / getDxfDocumentScaleFactor(documentOrItem);
}
