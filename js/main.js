// js/main.js
document.addEventListener("DOMContentLoaded", function () {
	var csInterface = new CSInterface();
	var selectedDxfPath = "";
	var selectedRulPath = "";
	var selectedInheritanceRulPath = "";

	var btnScan = document.getElementById("btn-scan");
	var btnSelectDxf = document.getElementById("btn-select-dxf");
	var btnSelectRul = document.getElementById("btn-select-rul");
	var btnClearRul = document.getElementById("btn-clear-rul");
	var btnImport = document.getElementById("btn-import");
	var dxfFileName = document.getElementById("dxf-file-name");
	var rulFileName = document.getElementById("rul-file-name");
	var notchStyle = document.getElementById("notch-style");
	var btnApplyStyle = document.getElementById("btn-apply-style");
	var sizeAnchor = document.getElementById("size-anchor");
	var orderCode = document.getElementById("order-code");
	var sizeTagHeight = document.getElementById("size-tag-height");
	var btnLabelSizes = document.getElementById("btn-label-sizes");
	var inheritanceBaseSize = document.getElementById("inheritance-base-size");
	var btnSetInheritanceBase = document.getElementById("btn-set-inheritance-base");
	var btnInheritSizes = document.getElementById("btn-inherit-sizes");
	var btnSelectInheritanceRul = document.getElementById("btn-select-inheritance-rul");
	var inheritanceRulFileName = document.getElementById("inheritance-rul-file-name");
	var btnAddFixedElements = document.getElementById("btn-add-fixed-elements");
	var btnRemoveFixedElements = document.getElementById("btn-remove-fixed-elements");
	var resultBox = document.getElementById("result-box");
	var hostOperationBusy = false;

	function getFileName(filePath) {
		var parts = String(filePath || "").split(/[\\\/]/);
		return parts.length > 0 ? parts[parts.length - 1] : "";
	}

	function updateFileDisplay(element, filePath, emptyText) {
		if (filePath) {
			element.textContent = getFileName(filePath);
			element.title = filePath;
			element.className = "file-name";
		} else {
			element.textContent = emptyText;
			element.title = "";
			element.className = "file-name empty";
		}
	}

	function updateImportState() {
		btnImport.disabled = !selectedDxfPath;
		btnClearRul.disabled = !selectedRulPath;
		updateFileDisplay(dxfFileName, selectedDxfPath, "未选择");
		updateFileDisplay(rulFileName, selectedRulPath, "未选择（可选）");
	}

	function updateInheritanceRulState() {
		updateFileDisplay(
			inheritanceRulFileName,
			selectedInheritanceRulPath,
			"未选择"
		);
		var hasBaseSize = !!inheritanceBaseSize.value;
		btnSetInheritanceBase.disabled = !hasBaseSize;
		btnInheritSizes.disabled = !hasBaseSize || !selectedInheritanceRulPath;
	}

	function readNumericInput(element, fallbackValue, allowZero) {
		var value = parseFloat(element.value);
		if (!isFinite(value) || value < 0 || (!allowZero && value === 0)) {
			value = fallbackValue;
			element.value = String(fallbackValue);
		}
		return value;
	}

	function selectFile(title, extension, callback) {
		if (!window.cep || !window.cep.fs || !window.cep.fs.showOpenDialogEx) {
			resultBox.value = "当前 CEP 环境不支持打开文件选择器。";
			return;
		}

		var picked = window.cep.fs.showOpenDialogEx(
			false,
			false,
			title,
			"",
			[extension]
		);
		if (picked.err === 0 && picked.data && picked.data.length > 0) {
			callback(picked.data[0]);
			updateImportState();
		}
	}

	function refreshSizeAnchorPairOptions(preferredValue) {
		csInterface.evalScript("getDxfSizeAnchorPairOptions()", function (result) {
			var previousValue = preferredValue || sizeAnchor.value;
			var lines = String(result || "").split(/\r?\n/);
			sizeAnchor.innerHTML = "";
			var placeholderOption = document.createElement("option");
			placeholderOption.value = "";
			placeholderOption.textContent = "请选择尺码锚点组";
			sizeAnchor.appendChild(placeholderOption);
			var optionCount = 0;
			for (var lineIndex = 0; lineIndex < lines.length; lineIndex++) {
				if (!lines[lineIndex] || lines[lineIndex].indexOf("ERROR|") === 0) {
					continue;
				}
				var separatorIndex = lines[lineIndex].indexOf("\t");
				if (separatorIndex < 1) {
					continue;
				}
				var option = document.createElement("option");
				option.value = lines[lineIndex].substring(0, separatorIndex);
				option.textContent = lines[lineIndex].substring(separatorIndex + 1);
				sizeAnchor.appendChild(option);
				optionCount++;
			}
			if (optionCount === 0) {
				placeholderOption.textContent = "暂无可配对锚点组";
			} else if (previousValue) {
				sizeAnchor.value = previousValue;
			}
			btnLabelSizes.disabled = !sizeAnchor.value;
		});
	}

	function refreshInheritanceSizeOptions(preferredValue) {
		csInterface.evalScript("getDxfInheritanceSizeOptions()", function (result) {
			var previousValue = preferredValue || inheritanceBaseSize.value;
			var lines = String(result || "").split(/\r?\n/);
			inheritanceBaseSize.innerHTML = "";
			var placeholderOption = document.createElement("option");
			placeholderOption.value = "";
			placeholderOption.textContent = "请选择基准尺码组";
			inheritanceBaseSize.appendChild(placeholderOption);
			var optionCount = 0;
			for (var lineIndex = 0; lineIndex < lines.length; lineIndex++) {
				if (!lines[lineIndex] || lines[lineIndex].indexOf("ERROR|") === 0) {
					continue;
				}
				var separatorIndex = lines[lineIndex].indexOf("\t");
				if (separatorIndex < 1) {
					continue;
				}
				var option = document.createElement("option");
				option.value = lines[lineIndex].substring(0, separatorIndex);
				option.textContent = lines[lineIndex].substring(separatorIndex + 1);
				inheritanceBaseSize.appendChild(option);
				optionCount++;
			}

			if (optionCount === 0) {
				placeholderOption.textContent = "暂无基准尺码组";
			} else if (previousValue) {
				inheritanceBaseSize.value = previousValue;
			}
			updateInheritanceRulState();
		});
	}

	btnScan.addEventListener("click", function () {
		resultBox.value = "正在扫描文档图层，请稍候...";
		hostOperationBusy = true;
		csInterface.evalScript("scanDxfDocumentPieces()", function (result) {
			hostOperationBusy = false;
			resultBox.value = result;
			refreshSizeAnchorPairOptions();
			refreshInheritanceSizeOptions();
		});
	});

	notchStyle.addEventListener("change", function () {
		var selectedNotchStyle = notchStyle.value || "straight";
		resultBox.value = "正在替换全部刀口样式...";
		hostOperationBusy = true;
		csInterface.evalScript(
			"replaceDxfNotchStyle(" + JSON.stringify(selectedNotchStyle) + ")",
			function (result) {
				hostOperationBusy = false;
				resultBox.value = result;
			}
		);
	});

	btnApplyStyle.addEventListener("click", function () {
		if (hostOperationBusy) {
			return;
		}
		resultBox.value = "正在应用参数样例样式...";
		hostOperationBusy = true;
		csInterface.evalScript("applyDxfSampleStyle()", function (result) {
			hostOperationBusy = false;
			resultBox.value = result;
		});
	});

	sizeAnchor.addEventListener("change", function () {
		btnLabelSizes.disabled = !sizeAnchor.value;
		if (!sizeAnchor.value || hostOperationBusy) {
			return;
		}
		csInterface.evalScript(
			"selectDxfSizeAnchorPair(" + JSON.stringify(sizeAnchor.value) + ")",
			function (result) {
				resultBox.value = result;
			}
		);
	});

	btnLabelSizes.addEventListener("click", function () {
		if (!sizeAnchor.value || hostOperationBusy) {
			return;
		}
		var normalizedOrderCode = String(orderCode.value || "").replace(/^\s+|\s+$/g, "");
		var heightMm = readNumericInput(sizeTagHeight, 4, false);
		resultBox.value = "正在自动配对内外线锚点并生成尺码标...";
		hostOperationBusy = true;
		csInterface.evalScript(
			"labelDxfPieceSizes(" +
			JSON.stringify(sizeAnchor.value) + ", " +
			JSON.stringify(normalizedOrderCode) + ", " +
			heightMm + ")",
			function (result) {
				hostOperationBusy = false;
				resultBox.value = result;
			}
		);
	});

	inheritanceBaseSize.addEventListener("change", function () {
		updateInheritanceRulState();
	});

	btnSelectInheritanceRul.addEventListener("click", function () {
		selectFile("选择本次继承使用的 RUL 放码规则", "rul", function (filePath) {
			selectedInheritanceRulPath = filePath;
			resultBox.value = "已选择本次继承 RUL：" + getFileName(filePath);
			updateInheritanceRulState();
		});
	});

	btnSetInheritanceBase.addEventListener("click", function () {
		if (!inheritanceBaseSize.value || hostOperationBusy) {
			return;
		}
		resultBox.value = "正在保存元素修改基准...";
		hostOperationBusy = true;
		csInterface.evalScript(
			"setDxfInheritanceBase(" + JSON.stringify(inheritanceBaseSize.value) + ")",
			function (result) {
				hostOperationBusy = false;
				resultBox.value = result;
			}
		);
	});

	btnInheritSizes.addEventListener("click", function () {
		if (!inheritanceBaseSize.value || !selectedInheritanceRulPath || hostOperationBusy) {
			return;
		}
		resultBox.value = "正在将基准尺码组的元素修改继承到其它尺码...";
		hostOperationBusy = true;
		csInterface.evalScript(
			"inheritDxfBaseToOtherSizes(" +
			JSON.stringify(selectedInheritanceRulPath) + ")",
			function (result) {
				hostOperationBusy = false;
				resultBox.value = result;
				selectedInheritanceRulPath = "";
				updateInheritanceRulState();
				refreshSizeAnchorPairOptions();
			}
		);
	});

	function setSelectedElementsFixedSize(isFixed) {
		if (hostOperationBusy) {
			return;
		}
		resultBox.value = isFixed ?
			"正在把选中对象加入固定元素继承..." :
			"正在把选中对象移出固定元素继承...";
		hostOperationBusy = true;
		csInterface.evalScript(
			"setDxfSelectedElementsFixedSize(" + (isFixed ? "true" : "false") + ")",
			function (result) {
				hostOperationBusy = false;
				resultBox.value = result;
			}
		);
	}

	btnAddFixedElements.addEventListener("click", function () {
		setSelectedElementsFixedSize(true);
	});

	btnRemoveFixedElements.addEventListener("click", function () {
		setSelectedElementsFixedSize(false);
	});

	btnSelectDxf.addEventListener("click", function () {
		selectFile("选择 ETCAD 导出的 DXF 文件", "dxf", function (filePath) {
			selectedDxfPath = filePath;
			resultBox.value = "已选择 DXF：" + getFileName(filePath);
		});
	});

	btnSelectRul.addEventListener("click", function () {
		selectFile("选择放码规则 RUL 文件（可选）", "rul", function (filePath) {
			selectedRulPath = filePath;
			resultBox.value = "已选择 RUL：" + getFileName(filePath);
		});
	});

	btnClearRul.addEventListener("click", function () {
		selectedRulPath = "";
		resultBox.value = "已清除 RUL，将只导入 DXF 基码。";
		updateImportState();
	});

	btnImport.addEventListener("click", function () {
		if (!selectedDxfPath) {
			resultBox.value = "请先选择 DXF 文件。";
			return;
		}

		var selectedNotchStyle = notchStyle.value || "straight";
		resultBox.value = selectedRulPath ?
			"正在导入 DXF 并应用 RUL 放码规则，请稍候..." :
			"正在导入 DXF 基码，请稍候...";
		hostOperationBusy = true;

		csInterface.evalScript(
			"importEtCadDxf(" +
			JSON.stringify(selectedDxfPath) + ", " +
			JSON.stringify(selectedNotchStyle) + ", " +
			JSON.stringify(selectedRulPath) + ")",
			function (result) {
				hostOperationBusy = false;
				resultBox.value = result;
				refreshSizeAnchorPairOptions("PAIR:1");
				refreshInheritanceSizeOptions();
			}
		);
	});

	updateImportState();
	updateInheritanceRulState();
	refreshSizeAnchorPairOptions("PAIR:1");
	refreshInheritanceSizeOptions();
});
