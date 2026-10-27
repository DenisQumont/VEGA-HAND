(function () {
  if (window.top !== window) {
    window.top.location.replace(window.location.href);
    return;
  }

  if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
    navigator.serviceWorker.getRegistrations().then(function (regs) {
      for (var i = 0; i < regs.length; i++) regs[i].unregister();
    }).catch(function () {});
  }

  var APP_VERSION = "1.0.0";

  var ROUTES = {
    "Главная": "ProfileHandShacke.html",
    "Контакты": "Contact.html",
    "Мониторинг": "Monitor.html",
    "Настройки": "Setting.html",
    "О системе": "InfoSystem.html",
    "Сервисный режим": "Service.html",
    "Карта схватов": "GripMap.html",
    "Добавить схват": "AddGrip.html",
    "Добавить протез": "AddProfile.html",
    "Расширенные настройки": "AdvancedSettings.html"
  };

  function normalize(value) {
    return (value || "").replace(/\s+/g, " ").trim();
  }

  function prosthesisConnected() {
    return !!(phoneServer && phoneServer.connected) || !!bleState.connected;
  }

  function forgetPhone() {
    try {
      localStorage.removeItem("vega-prosthesis");
      localStorage.removeItem("vega-ble");
      localStorage.removeItem("vega-device-id");
      localStorage.removeItem("vega-device-name");
    } catch (e) {}
  }

  var leaving = false;

  function go(file) {
    if (file === "ProfileHandShacke.html" && !prosthesisConnected()) file = "AddProfile.html";
    if ((file === "Monitor.html" || file === "Service.html") && !prosthesisConnected()) {
      toast("Сначала подключите протез", 4000);
      return;
    }
    if (window.parent !== window) {
      window.parent.postMessage({ type: "vega-nav", file: file }, "*");
      return;
    }
    showPage(file);
  }

  var bleState = { connected: false, bridge: false, mode: "", k1: 1, k2: 1, error: null };
  var localSocket = null;
  var pendingMode = "";
  var editingSensor = "";

  function phoneLink() {
    try { return localStorage.getItem("vega-ble") === "phone"; }
    catch (e) { return false; }
  }

  function bleRequest(payload) {
    if (phoneLink() || payload && payload.cmd === "phone") {
      handlePhone(payload);
      return;
    }
    if (window.parent !== window) {
      window.parent.postMessage({ type: "vega-ble", payload: payload }, "*");
      return;
    }
    if (!localSocket || localSocket.readyState !== 1) {
      var url = (location.protocol === "https:" ? "wss://" : "ws://") + location.hostname + ":8092";
      localSocket = new WebSocket(url);
      localSocket.addEventListener("message", function (event) {
        onBleEvent(JSON.parse(event.data));
      });
      localSocket.addEventListener("open", function () {
        localSocket.send(JSON.stringify(payload));
      });
      localSocket.addEventListener("close", function () {
        onBleEvent({ event: "status", bridge: false, connected: false, reason: "disconnect" });
      });
      return;
    }
    localSocket.send(JSON.stringify(payload));
  }

  function toast(text, ms) {
    if (!text) return;
    var el = document.getElementById("vega-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "vega-toast";
      el.style.cssText = "position:fixed;left:50%;bottom:5.6rem;transform:translateX(-50%);width:18.5rem;padding:0.75rem 0.9rem;border-radius:0.75rem;background:#222;color:#fff;font-family:Roboto-Medium,sans-serif;font-size:0.8125rem;line-height:1.15rem;z-index:8;display:none;text-align:center;";
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.style.display = "block";
    window.clearTimeout(el._timer);
    if (ms !== 0) el._timer = window.setTimeout(function () { el.style.display = "none"; }, ms || 3600);
  }

  function hideToast() {
    var el = document.getElementById("vega-toast");
    if (!el) return;
    window.clearTimeout(el._timer);
    el.style.display = "none";
  }

  function paintText(id, value) {
    var node = document.getElementById(id);
    if (!node || value == null || value === "") return;
    node.textContent = value;
  }

  function paintStatusDot(id, color) {
    var dot = document.getElementById(id);
    if (!dot) return;
    dot.style.backgroundImage = "none";
    dot.style.backgroundColor = color;
    dot.style.borderRadius = "50%";
  }

  function linkStatus() {
    if (!bleState.connected) return { text: "Нет связи", color: "rgb(180,180,180)", btn: "rgb(149,154,157)" };
    if (bleState.prosthesisState === 0) return { text: "Заблокирован", color: "rgb(214,40,40)", btn: "rgb(214,40,40)" };
    return { text: "Подключен", color: "rgb(13,199,54)", btn: "rgb(55,90,118)" };
  }

  var BATTERY_IDS = ["34_171", "34_478", "34_444", "35_714", "35_444", "34_821", "34_696"];
  var DIS_STATUS_BTNS = ["34_451", "34_417", "35_687", "35_277", "35_523", "34_669"];
  var DIS_STATUS_LABELS = ["34_452", "34_418", "35_688", "35_278", "35_524", "34_670"];
  var DEVICE_NAME_IDS = ["34_170", "34_483", "34_825", "34_701", "34_449"];
  var STATUS_TEXT_IDS = ["34_173_0", "34_481", "34_447", "34_823", "34_699"];
  var STATUS_DOT_IDS = ["34_174", "34_482", "34_824", "34_700"];

  function paintBattery() {
    var text = bleState.battery != null ? bleState.battery + "%" : "";
    var seen = {};
    BATTERY_IDS.forEach(function (id) {
      if (seen[id]) return;
      seen[id] = 1;
      var node = document.getElementById(id);
      if (!node) return;
      node.textContent = text;
      node.style.visibility = bleState.battery != null ? "visible" : "hidden";
    });
  }

  function paintDisStatusButton() {
    var connected = !!bleState.connected;
    DIS_STATUS_BTNS.forEach(function (id) {
      var btn = document.getElementById(id);
      if (!btn) return;
      btn.style.backgroundColor = connected ? "rgb(55,90,118)" : "rgb(149,154,157)";
      btn.style.cursor = connected ? "pointer" : "default";
      btn.setAttribute("data-vega-dis-status", "1");
    });
    DIS_STATUS_LABELS.forEach(function (id) {
      paintText(id, "Отключить");
    });
  }

  function paintGripInfo() {
    if (bleState.grip == null) return;
    var gripLabel = bleState.gripName || ("Схват " + bleState.grip);
    var gripName = document.getElementById("34_230_0_1");
    if (gripName) {
      gripName.textContent = "Активный схват: " + gripLabel;
      gripName.style.fontSize = "";
      gripName.style.letterSpacing = "";
      gripName.style.whiteSpace = "nowrap";
      gripName.style.display = "inline-block";
      gripName.style.transformOrigin = "left center";
      gripName.style.transform = "none";
      var gripLine = gripName.parentElement;
      if (gripLine) {
        gripLine.style.whiteSpace = "nowrap";
        gripLine.style.overflow = "hidden";
        gripLine.style.maxWidth = "100%";
      }
      window.requestAnimationFrame(function () {
        if (!gripName.isConnected) return;
        var avail = (gripLine && gripLine.clientWidth) || 0;
        var need = gripName.scrollWidth;
        if (avail > 0 && need > avail) {
          gripName.style.transform = "scaleX(" + (avail / need) + ")";
        }
      });
    }
    paintText("34_230_1_1", "Номер схвата: " + bleState.grip);
    var monitorGrip = document.getElementById("34_826");
    if (monitorGrip) {
      monitorGrip.style.whiteSpace = "nowrap";
      monitorGrip.style.lineHeight = "1.25rem";
      monitorGrip.style.textAlign = "right";
      monitorGrip.style.overflow = "hidden";
      monitorGrip.style.transformOrigin = "right center";
      monitorGrip.style.transform = "none";
      monitorGrip.textContent = bleState.grip + " · " + gripLabel;
      window.requestAnimationFrame(function () {
        if (!monitorGrip.isConnected) return;
        var avail = monitorGrip.clientWidth || 0;
        var need = monitorGrip.scrollWidth;
        if (avail > 0 && need > avail) {
          monitorGrip.style.transform = "scaleX(" + (avail / need) + ")";
        }
      });
    }
  }

  function paintLink() {
    var status = linkStatus();
    STATUS_TEXT_IDS.forEach(function (id) { paintText(id, status.text); });
    STATUS_DOT_IDS.forEach(function (id) { paintStatusDot(id, status.color); });
    paintDisStatusButton();
    paintBattery();
    if (bleState.deviceName) {
      DEVICE_NAME_IDS.forEach(function (id) { paintText(id, bleState.deviceName); });
    }
    paintGripInfo();
    paintLockedNav();
    paintAppVersion();
    var trigger = document.getElementById("34_815");
    if (trigger) {
      trigger.style.backgroundImage = "none";
      trigger.style.backgroundColor = bleState.trigger ? "rgb(55,90,118)" : "rgb(180,180,180)";
      trigger.style.borderRadius = "50%";
    }
    paintText("34_462", bleState.manufacturer);
    var serial = document.getElementById("34_465");
    if (serial && bleState.serial) {
      serial.textContent = bleState.serial;
      serial.style.width = "11.5rem";
      serial.style.left = "auto";
      serial.style.right = "0";
    }
    paintText("34_468", bleState.hardware);
    paintText("34_471", bleState.software);
    paintText("34_474", bleState.firmware);
  }

  function paintAppVersion() {
    paintText("34_224", "VEGA ToolHand v" + APP_VERSION);
    paintText("34_401", "VEGA ToolHand v" + APP_VERSION);
    paintText("35_649", "v" + APP_VERSION);
  }

  function paintLockedNav() {
    var locked = !prosthesisConnected();
    var nodes = document.querySelectorAll("p");
    for (var i = 0; i < nodes.length; i++) {
      var label = normalize(nodes[i].textContent);
      if (label !== "Мониторинг" && label !== "Сервисный режим") continue;
      var shell = nodes[i];
      while (shell && shell !== document.body) {
        var style = shell.getAttribute("style") || "";
        var tab = label === "Мониторинг" && style.indexOf("height: 3.625rem") !== -1;
        var service = label === "Сервисный режим" && (shell.id === "39_1" || style.indexOf("height: 3.3125rem") !== -1 && style.indexOf("width: 13.3125rem") !== -1);
        if (tab || service || (label === "Сервисный режим" && shell.id === "39_1")) {
          shell.style.opacity = locked ? "0.4" : "";
          shell.style.filter = locked ? "grayscale(0.4)" : "";
          break;
        }
        shell = shell.parentElement;
      }
    }
  }

  function ensureDevicePicker() {
    var dialog = document.getElementById("vega-devices");
    if (dialog) return dialog;
    dialog = document.createElement("div");
    dialog.id = "vega-devices";
    dialog.style.cssText = "display:none;width:22.5rem;max-height:28rem;overflow:auto;position:fixed;left:0;right:0;margin:0 auto;bottom:4.5rem;border-radius:0.875rem 0.875rem 0 0;background:#fefefe;box-shadow:0 -0.125rem 0.375rem rgba(0,0,0,.25);z-index:6;padding:1.25rem 1.25rem 1.5rem;";
    dialog.innerHTML = '<p data-vega-device-title style="margin:0 0 0.35rem;font-family:Roboto-Bold,sans-serif;font-weight:700;font-size:1.375rem;color:#222;">Протезы рядом</p><p data-vega-device-note style="margin:0 0 0.9rem;font-family:Roboto-Regular,sans-serif;font-size:0.875rem;color:#666;">Поиск</p><div data-vega-device-list></div>';
    document.body.appendChild(dialog);
    return dialog;
  }

  function renderDevices(devices) {
    var dialog = ensureDevicePicker();
    var note = dialog.querySelector("[data-vega-device-note]");
    var list = dialog.querySelector("[data-vega-device-list]");
    list.innerHTML = "";
    if (!devices || !devices.length) {
      note.textContent = bleState.bridge ? "Протезы не найдены. Включите протез и повторите поиск." : "Мост BLE не запущен. На компьютере выполните: python bridge/serve.py";
      return;
    }
    note.textContent = "Выберите протез для подключения";
    devices.forEach(function (device) {
      var button = document.createElement("button");
      button.type = "button";
      button.setAttribute("data-vega-address", device.address);
      button.textContent = device.name + (device.rssi != null ? "  " + device.rssi + " dBm" : "");
      button.style.cssText = "display:block;width:100%;margin:0 0 0.5rem;padding:0.85rem 1rem;border:0.125rem solid #000;border-radius:0.75rem;background:#fff;font-family:Roboto-Medium,sans-serif;font-size:0.875rem;text-align:left;cursor:pointer;";
      button.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        note.textContent = "Подключение к " + device.name + "…";
        bleRequest({ cmd: "connect", address: device.address });
      });
      list.appendChild(button);
    });
  }

  var PHONE_SERVICE = "55865178-6434-3234-1251-136459739abb";
  var PHONE_OUTPUT = "55865178-6434-3234-1251-13645973aa01";
  var PHONE_INPUT = "55865178-6434-3234-1251-13645973aa02";
  var PHONE_MYO_READ = "55865178-6434-3234-1251-13645973aa03";
  var PHONE_MYO_WRITE = "55865178-6434-3234-1251-13645973aa04";
  var PHONE_SERIAL = "55865178-6434-3234-1251-13645973aa07";
  var PHONE_GRIPS = ["Раскрытая ладонь", "Нейтральный схват", "Силовой схват", "Кулачный схват", "Схват удержания чашки", "Удерживающий схват", "Цилиндрический схват", "Плоская ладонь", "Схват для нажатия", "Указательный жест", "Схват удержания карты", "Трехпалый щепоть", "Двухпалый щепоть", "Боковой схват", "Закрытый схват", "Пользовательский схват №1", "Пользовательский схват №2"];
  var PHONE_MYO_KEYS = ["dir_treshold", "TrigPercentTreshold", "TriggerBlocks", "TrigTresholdHigh", "TrigTresholdLow", "DifTriggerPlus", "DifTriggerMinus", "TrigDelayMax", "DifTrDelayMinus", "DifMovePlus", "DifMoveMinus", "MoveTresholdHigh", "MoveBlocks", "dead_Zone_Myo1", "dead_Zone_Myo2"];
  var phoneServer = null;
  var phoneInput = null;
  var phoneMyoRead = null;
  var phoneMyoWrite = null;
  var phoneTelemetry = null;
  var phoneJob = null;
  var phoneBusy = false;
  var resumeLock = null;

  function phoneErrorText(code) {
    var names = { 1: "Нет связи с контроллером протеза", 2: "Нет связи BLE", 6: "Неисправность аккумулятора", 7: "Неисправность миодатчика 1", 8: "Неисправность миодатчика 2", 84: "Неисправны оба миодатчика" };
    if (!code) return "";
    return names[code] || ("Код ошибки " + code);
  }

  function unpackPhone(view) {
    if (!view || view.byteLength !== 62) return null;
    var grip = view.getUint8(1);
    var error = view.getUint8(2);
    var secure = view.getUint8(61);
    return {
      state: view.getUint8(0),
      grip: grip,
      gripName: PHONE_GRIPS[grip] || ("Схват " + grip),
      error: error,
      errorText: phoneErrorText(error),
      myoMode: view.getInt8(3),
      trigger: view.getUint8(4),
      custom1Speed: [0, 1, 2, 3, 4, 5].map(function (i) { return view.getInt8(11 + i); }),
      custom1Pos: [0, 1, 2, 3, 4, 5].map(function (i) { return view.getInt8(17 + i); }),
      custom2Speed: [0, 1, 2, 3, 4, 5].map(function (i) { return view.getInt8(23 + i); }),
      custom2Pos: [0, 1, 2, 3, 4, 5].map(function (i) { return view.getInt8(29 + i); }),
      myo1: view.getUint16(35, true),
      myo2: view.getUint16(37, true),
      k1: Math.round(view.getFloat32(53, true) * 10) / 10,
      k2: Math.round(view.getFloat32(57, true) * 10) / 10,
      connectionMode: secure,
      mode: secure ? "user" : "service",
      lowBattery: view.getUint8(0) === 0x28
    };
  }

  function packPhoneInput(state, source, k1, k2) {
    source = source || {};
    var view = new DataView(new ArrayBuffer(41));
    var coefficient1 = Math.round(Number(k1 == null ? (source.k1 == null ? 1 : source.k1) : k1) * 10) / 10;
    var coefficient2 = Math.round(Number(k2 == null ? (source.k2 == null ? 1 : source.k2) : k2) * 10) / 10;
    if (coefficient1 < 0 || coefficient1 > 1 || coefficient2 < 0 || coefficient2 > 1) throw new Error("Коэффициент миодатчика должен быть от 0.0 до 1.0");
    view.setUint8(0, state & 255);
    view.setUint8(1, (source.grip || 0) & 255);
    view.setInt8(2, source.myoMode || 0);
    var lists = [source.custom1Speed, source.custom1Pos, source.custom2Speed, source.custom2Pos];
    var offset = 9;
    lists.forEach(function (list) {
      for (var i = 0; i < 6; i++) view.setInt8(offset + i, list && list[i] ? list[i] : 0);
      offset += 6;
    });
    view.setFloat32(33, coefficient1, true);
    view.setFloat32(37, coefficient2, true);
    return view.buffer;
  }

  function packPhoneMyo(values) {
    var defaults = { dir_treshold: 105, TrigPercentTreshold: 2, TriggerBlocks: 50, TrigTresholdHigh: 945, TrigTresholdLow: 819, DifTriggerPlus: 50, DifTriggerMinus: 6, TrigDelayMax: 945, DifTrDelayMinus: 1, DifMovePlus: 3, DifMoveMinus: 2, MoveTresholdHigh: 315, MoveBlocks: 20, dead_Zone_Myo1: 250, dead_Zone_Myo2: 250 };
    var view = new DataView(new ArrayBuffer(30));
    PHONE_MYO_KEYS.forEach(function (key, index) {
      var number = parseInt(values && values[key] != null ? values[key] : defaults[key], 10);
      if (isNaN(number) || number < 0 || number > 65535) throw new Error("Значение вне диапазона 0...65535");
      view.setUint16(index * 2, number, true);
    });
    return view.buffer;
  }

  function phoneWait(ms) {
    return new Promise(function (resolve) { window.setTimeout(resolve, ms); });
  }

  function phoneFailText(error) {
    var name = error && error.name || "";
    var message = error && error.message || "";
    if (name === "NetworkError" || name === "NotSupportedError" || name === "NotFoundError") {
      return "Телефон не смог подключиться. Если появится запрос PIN, введите PIN протеза. Заводской PIN — 123456, если его не меняли.";
    }
    return message || name || "Не удалось подключиться к протезу";
  }

  function isPickerCancel(error) {
    if (error == null) return true;
    var name = String(error.name || "");
    var message = String(error.message || error.reason || error || "");
    if (name === "AbortError" || name === "NotFoundError") return true;
    // Bluefy / WebKit иногда отдают отмену без стандартного name.
    if (/abort|cancel|dismiss|отмен|choos|no device|user denied|not found|closed/i.test(message)) return true;
    if (error.code === 8 || error.code === 20) return true;
    return false;
  }

  function onPhoneDrop() {
    if (leaving || phoneBusy) return;
    phoneServer = null;
    phoneInput = null;
    phoneMyoRead = null;
    phoneMyoWrite = null;
    phoneTelemetry = null;
    bleState.battery = null;
    try {
      localStorage.removeItem("vega-prosthesis");
      localStorage.removeItem("vega-ble");
      localStorage.removeItem("vega-device-id");
    } catch (e) {}
    onBleEvent({ event: "status", bridge: "phone", connected: false, reason: "disconnect" });
  }

  function disconnectProsthesis() {
    hideOverlays();
    phoneBusy = true;
    try {
      if (window.__vegaBleDevice && window.__vegaBleDevice.gatt && window.__vegaBleDevice.gatt.connected) {
        window.__vegaBleDevice.gatt.disconnect();
      }
    } catch (e) {}
    phoneServer = null;
    phoneInput = null;
    phoneMyoRead = null;
    phoneMyoWrite = null;
    phoneTelemetry = null;
    phoneBusy = false;
    bleState.battery = null;
    forgetPhone();
    onBleEvent({ event: "status", bridge: "phone", connected: false, reason: "disconnect" });
    toast("Протез отключён", 3500);
  }

  function connectPhone(device, reason) {
    if (phoneJob) return phoneJob;
    bleState.battery = null;
    paintBattery();
    window.__vegaBleDevice = device;
    phoneJob = device.gatt.connect().then(function (server) {
      phoneServer = server;
      device.ongattserverdisconnected = onPhoneDrop;
      return server.getPrimaryService(PHONE_SERVICE);
    }).then(function (service) {
      function takeChar(uuid) {
        return gattCall(function () { return service.getCharacteristic(uuid); }).catch(function () { return null; });
      }
      return takeChar(PHONE_OUTPUT).then(function (output) {
        if (!output) throw new Error("Протез не отдал канал телеметрии");
        return takeChar(PHONE_INPUT).then(function (input) {
          return takeChar(PHONE_MYO_READ).then(function (myoRead) {
            return takeChar(PHONE_MYO_WRITE).then(function (myoWrite) {
              return takeChar(PHONE_SERIAL).then(function (serial) {
                return [output, input, myoRead, myoWrite, serial];
              });
            });
          });
        });
      });
    }).then(function (chars) {
      phoneInput = chars[1];
      phoneMyoRead = chars[2];
      phoneMyoWrite = chars[3];
      chars[0].addEventListener("characteristicvaluechanged", function (event) {
        var packet = unpackPhone(event.target.value);
        if (!packet) return;
        phoneTelemetry = packet;
        var message = { event: "telemetry", bridge: "phone" };
        Object.keys(packet).forEach(function (key) { message[key] = packet[key]; });
        onBleEvent(message);
      });
      return chars[0].startNotifications().then(function () {
        onBleEvent({
          event: "status",
          bridge: "phone",
          connected: true,
          reason: reason || "hello",
          name: device.name || "",
          mode: phoneTelemetry ? phoneTelemetry.mode : ""
        });
        loadPhoneProfile(chars[4]);
      });
    }).then(function () {
      phoneJob = null;
    }, function (error) {
      phoneJob = null;
      throw error;
    });
    return phoneJob;
  }

  function gattCall(fn) {
    try {
      return Promise.resolve().then(fn);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  function decodeBleText(view) {
    if (!view) return "";
    try {
      var bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
      return new TextDecoder("utf-8").decode(bytes).replace(/\0[\s\S]*/, "").trim();
    } catch (error) {
      return "";
    }
  }

  function readPhoneBattery() {
    if (!phoneServer || !phoneServer.connected) return Promise.resolve();
    return gattCall(function () {
      return phoneServer.getPrimaryService("0000180f-0000-1000-8000-00805f9b34fb");
    }).then(function (service) {
      return service.getCharacteristic("00002a19-0000-1000-8000-00805f9b34fb");
    }).then(function (char) {
      return char.readValue();
    }).then(function (view) {
      if (view) onBleEvent({ event: "info", bridge: "phone", battery: view.getUint8(0) });
    }).catch(function () {});
  }

  function loadPhoneProfile(serialChar) {
    var fields = [
      ["00002a29-0000-1000-8000-00805f9b34fb", "manufacturer"],
      ["00002a27-0000-1000-8000-00805f9b34fb", "hardware"],
      ["00002a28-0000-1000-8000-00805f9b34fb", "software"],
      ["00002a26-0000-1000-8000-00805f9b34fb", "firmware"]
    ];
    function stillUp() {
      return !!(phoneServer && phoneServer.connected);
    }
    // Заряд читаем сразу — не ждём DIS/serial.
    var chain = readPhoneBattery();
    if (serialChar) {
      chain = chain.then(function () {
        if (!stillUp()) return;
        return gattCall(function () { return serialChar.readValue(); }).then(function (view) {
          var text = decodeBleText(view);
          if (text) onBleEvent({ event: "info", bridge: "phone", serial: text });
        });
      }).catch(function () {});
    }
    fields.forEach(function (pair) {
      chain = chain.then(function () {
        if (!stillUp()) return;
        return gattCall(function () { return phoneServer.getPrimaryService("0000180a-0000-1000-8000-00805f9b34fb"); }).then(function (service) {
          return service.getCharacteristic(pair[0]);
        }).then(function (char) {
          return char.readValue();
        }).then(function (view) {
          var text = decodeBleText(view);
          if (!text) return;
          var message = { event: "info", bridge: "phone" };
          message[pair[1]] = text;
          onBleEvent(message);
        });
      }).catch(function () {});
    });
  }

  function findPhoneDevice(attempt) {
    var id = "";
    try { id = localStorage.getItem("vega-device-id") || ""; } catch (e) {}
    return navigator.bluetooth.getDevices().then(function (devices) {
      var device = null;
      for (var i = 0; i < devices.length; i++) {
        if (!id || devices[i].id === id) { device = devices[i]; break; }
      }
      if (device || attempt >= 5) return device;
      return phoneWait(400).then(function () { return findPhoneDevice(attempt + 1); });
    });
  }

  function connectWithRetry(device, left) {
    phoneBusy = true;
    return connectPhone(device, "hello").then(function () {
      phoneBusy = false;
    }, function (error) {
      if (left <= 1) {
        phoneBusy = false;
        throw error;
      }
      return phoneWait(800).then(function () { return connectWithRetry(device, left - 1); });
    });
  }

  function resumePhone() {
    if (phoneServer && phoneServer.connected) {
      paintLink();
      if (screenName === "AddProfile.html") go("ProfileHandShacke.html");
      return;
    }
    if (!navigator.bluetooth || !navigator.bluetooth.getDevices) {
      forgetPhone();
      if (screenName === "ProfileHandShacke.html") go("AddProfile.html");
      return;
    }
    if (resumeLock) return;
    var name = "протезу";
    try { name = localStorage.getItem("vega-device-name") || name; } catch (e) {}
    toast("Подключение к " + name + "… Если система спросит PIN, введите PIN протеза.", 0);
    resumeLock = findPhoneDevice(0).then(function (device) {
      if (!device) throw new Error("Телефон не запомнил выбранный протез. Выберите его ещё раз.");
      return connectWithRetry(device, 4);
    }).then(function () {
      hideToast();
      if (screenName === "AddProfile.html") go("ProfileHandShacke.html");
    }, function (error) {
      var text = phoneFailText(error);
      try { sessionStorage.setItem("vega-ble-error", text); } catch (e) {}
      forgetPhone();
      if (screenName === "ProfileHandShacke.html") go("AddProfile.html");
      else toast(text, 12000);
    });
    resumeLock.then(function () { resumeLock = null; }, function () { resumeLock = null; });
  }

  function writePhone(char, data) {
    if (!char) return Promise.reject(new Error("Протез не подключён"));
    if (char.writeValueWithoutResponse) return char.writeValueWithoutResponse(data);
    return char.writeValue(data);
  }

  function readPhoneMyo() {
    if (!phoneMyoRead) {
      onBleEvent({ event: "error", message: "Протез не отдал тонкие настройки миодатчиков" });
      return Promise.resolve();
    }
    return phoneMyoRead.readValue().then(function (view) {
      if (view.byteLength !== 30) throw new Error("Настройки миодатчиков должны быть 30 байт");
      var values = {};
      PHONE_MYO_KEYS.forEach(function (key, index) { values[key] = view.getUint16(index * 2, true); });
      onBleEvent({ event: "myo", values: values });
    });
  }

  function handlePhone(payload) {
    var command = payload && payload.cmd;
    if (command === "hello" || command === "phone") {
      resumePhone();
      return;
    }
    if (!phoneServer || !phoneServer.connected) {
      toast("Протез не подключён");
      return;
    }
    var job = Promise.resolve();
    if (command === "mode") {
      var code = payload.mode === "service" ? 0x21 : 0x22;
      job = writePhone(phoneInput, packPhoneInput(code, phoneTelemetry)).then(function () {
        onBleEvent({ event: "mode", message: "Команда отправлена. Протез перезагрузит BLE, связь может прерваться." });
      });
    } else if (command === "read_myo") {
      job = readPhoneMyo();
    } else if (command === "write_myo") {
      job = writePhone(phoneInput, packPhoneInput(0x31, phoneTelemetry)).then(function () {
        return writePhone(phoneMyoWrite, packPhoneMyo(payload.values));
      }).then(function () {
        onBleEvent({ event: "myo", written: true });
      });
    } else if (command === "set_k") {
      var k1 = payload.k1;
      var k2 = payload.k2;
      if (phoneTelemetry) {
        if (k1 == null) k1 = phoneTelemetry.k1;
        if (k2 == null) k2 = phoneTelemetry.k2;
      }
      if (Number(payload.sensor) === 1) k1 = payload.value;
      if (Number(payload.sensor) === 2) k2 = payload.value;
      job = writePhone(phoneInput, packPhoneInput(0x24, phoneTelemetry, k1, k2)).then(function () {
        onBleEvent({ event: "k", k1: k1, k2: k2 });
      });
    }
    job.catch(function (error) {
      onBleEvent({ event: "error", message: error && error.message ? error.message : "Ошибка BLE" });
    });
  }

  function dropPhoneLinkQuiet() {
    phoneBusy = true;
    try {
      if (window.__vegaBleDevice && window.__vegaBleDevice.gatt && window.__vegaBleDevice.gatt.connected) {
        window.__vegaBleDevice.gatt.disconnect();
      }
    } catch (e) {}
    phoneServer = null;
    phoneInput = null;
    phoneMyoRead = null;
    phoneMyoWrite = null;
    phoneTelemetry = null;
    phoneJob = null;
    bleState.battery = null;
    phoneBusy = false;
  }

  function openProsthesisChooser() {
    hideOverlays();
    if (navigator.bluetooth && navigator.bluetooth.requestDevice) {
      openDevicePicker();
      return;
    }
    var dialog = ensureDevicePicker();
    dialog.style.display = "block";
    dialog.style.position = "fixed";
    dialog.style.zIndex = "6";
    scrim.style.display = "block";
    bleRequest({ cmd: "hello" });
  }

  function openDevicePicker() {
    pendingMode = "";
    editingSensor = "";
    if (window.top !== window) {
      window.top.location.replace(window.location.href);
      return;
    }
    if (!navigator.bluetooth || !navigator.bluetooth.requestDevice) {
      toast("На iPhone откройте эту страницу в Bluefy. В остальных телефонах нужен Chrome.", 12000);
      return;
    }
    var services = [
      PHONE_SERVICE,
      "0000180f-0000-1000-8000-00805f9b34fb",
      "0000180a-0000-1000-8000-00805f9b34fb"
    ];
    var iphone = /iPhone|iPad|Bluefy/i.test(navigator.userAgent || "");
    var options = iphone
      ? { acceptAllDevices: true, optionalServices: services }
      : { filters: [{ namePrefix: "VEGA" }], optionalServices: services };
    var request;
    try {
      request = navigator.bluetooth.requestDevice(options);
    } catch (error) {
      if (isPickerCancel(error)) {
        toast("Подключение нового протеза отменено", 4000);
        return;
      }
      toast(phoneFailText(error), 12000);
      return;
    }
    request.then(function (device) {
      var currentId = window.__vegaBleDevice && window.__vegaBleDevice.id;
      if (phoneServer && phoneServer.connected && currentId && currentId === device.id) {
        hideToast();
        go("ProfileHandShacke.html");
        return;
      }
      toast("Подключение к " + (device.name || "протезу") + "…", 0);
      // Рвём старое соединение только после выбора нового устройства.
      if (phoneServer && phoneServer.connected) dropPhoneLinkQuiet();
      return connectPhone(device, "hello").then(function () {
        try {
          localStorage.setItem("vega-device-id", device.id);
          localStorage.setItem("vega-device-name", device.name || "VEGA");
          localStorage.setItem("vega-ble", "phone");
          localStorage.setItem("vega-prosthesis", "1");
        } catch (e) {}
        hideToast();
        go("ProfileHandShacke.html");
      }, function (error) {
        hideToast();
        toast(phoneFailText(error), 12000);
      });
    }, function (error) {
      // Только отмена/закрытие системного выбора устройства.
      hideToast();
      toast("Подключение нового протеза отменено", 4000);
    });
  }

  function confirmMode(mode) {
    pendingMode = mode;
    editingSensor = "";
    var service = mode === "service";
    var dialog = openStub(
      service ? "Сервисный режим протеза" : "Пользовательский режим",
      service ? "Протез перейдёт в сервисный режим и перезагрузит BLE. Телефонное подключение при этом разорвётся." : "Протез вернётся в пользовательский режим и перезагрузит BLE.",
      "",
      "Отправить",
      "Подтвердите переключение",
      ""
    );
    var box = dialog.querySelector("[data-vega-stub-box]");
    if (box) box.style.display = "none";
  }

  function onBleEvent(payload) {
    if (!payload || !payload.event) return;
    if (payload.event === "status") {
      if (payload.bridge !== "phone" && phoneLink()) return;
      bleState.connected = !!payload.connected;
      bleState.bridge = !!payload.bridge;
      if (payload.mode) bleState.mode = payload.mode;
      if (payload.name) bleState.deviceName = payload.name;
      try {
        if (payload.connected) localStorage.setItem("vega-prosthesis", "1");
        else if (payload.reason === "disconnect") localStorage.removeItem("vega-prosthesis");
      } catch (e) {}
      if (!payload.connected) bleState.battery = null;
      paintLink();
      if (payload.connected) hideToast();
      if (!payload.connected && payload.reason === "disconnect" && screenName === "ProfileHandShacke.html") {
        go("AddProfile.html");
      }
      if (payload.reason === "hello" && !payload.bridge) {
        var note = document.querySelector("#vega-devices [data-vega-device-note]");
        if (note && document.getElementById("vega-devices").style.display !== "none") {
          note.textContent = "Мост BLE не запущен. На компьютере выполните: python bridge/serve.py";
        }
      }
      return;
    }
    if (payload.event === "devices") {
      bleState.bridge = true;
      renderDevices(payload.devices || []);
      return;
    }
    if (payload.event === "telemetry") {
      bleState.connected = true;
      bleState.mode = payload.mode || bleState.mode;
      bleState.k1 = payload.k1;
      bleState.k2 = payload.k2;
      if (payload.state != null) bleState.prosthesisState = payload.state;
      if (payload.grip != null) {
        bleState.grip = payload.grip;
        bleState.gripName = payload.gripName;
      }
      bleState.trigger = payload.trigger;
      if (payload.error !== bleState.error) {
        bleState.error = payload.error;
        if (payload.errorText) toast(payload.errorText);
      }
      if (payload.lowBattery && !bleState.lowBattery) toast("Протез разряжен", 8000);
      var connecting = document.getElementById("vega-toast");
      if (connecting && connecting.textContent.indexOf("Подключение") === 0) hideToast();
      bleState.lowBattery = !!payload.lowBattery;
      paintLink();
      return;
    }
    if (payload.event === "info") {
      if (payload.serial) bleState.serial = payload.serial;
      if (payload.firmware) bleState.firmware = payload.firmware;
      if (payload.hardware) bleState.hardware = payload.hardware;
      if (payload.software) bleState.software = payload.software;
      if (payload.manufacturer) bleState.manufacturer = payload.manufacturer;
      if (payload.name) bleState.deviceName = payload.name;
      if (payload.battery != null) bleState.battery = payload.battery;
      paintLink();
      return;
    }
    if (payload.event === "myo" && payload.values && !payload.written) {
      try { sessionStorage.setItem("vega-myo-advanced", JSON.stringify(payload.values)); } catch (e) {}
      if (typeof paintParamValues === "function") paintParamValues();
      toast("Настройки миодатчиков прочитаны с протеза");
      return;
    }
    if (payload.event === "myo" && payload.written) {
      toast("Настройки миодатчиков отправлены");
      return;
    }
    if (payload.event === "mode") {
      toast(payload.message || "Режим отправлен");
      return;
    }
    if (payload.event === "k") {
      bleState.k1 = payload.k1;
      bleState.k2 = payload.k2;
      toast("Коэффициент миодатчика отправлен");
      return;
    }
    if (payload.event === "error") toast(payload.message || "Ошибка BLE");
  }

  window.addEventListener("message", function (event) {
    if (!event.data || event.data.type !== "vega-ble-event") return;
    onBleEvent(event.data.payload);
  });

  var sheets = [];
  var valueDialog = null;

  function ensureRoot() {
    var root = document.getElementById("vega-root");
    if (root) return root;
    root = document.createElement("div");
    root.id = "vega-root";
    var pending = Array.prototype.slice.call(document.body.childNodes);
    document.body.appendChild(root);
    pending.forEach(function (node) {
      if (node.tagName === "SCRIPT") return;
      root.appendChild(node);
    });
    return root;
  }

  function sheetTitle(el) {
    var text = el.textContent || "";
    if (text.indexOf("Список устройств") !== -1 && text.indexOf("Доступные") !== -1) return "Список устройств";
    if (text.indexOf("Информация об устройстве") !== -1) return "Информация об устройстве";
    return "";
  }

  function collectSheets() {
    var stale = document.body.querySelectorAll("[data-vega-sheet]");
    for (var s = 0; s < stale.length; s++) {
      if (stale[s].parentElement === document.body) stale[s].parentElement.removeChild(stale[s]);
    }
    var scope = document.getElementById("vega-root") || document;
    sheets = Array.prototype.filter.call(scope.querySelectorAll("div"), function (el) {
      var style = el.getAttribute("style") || "";
      var hit = style.indexOf("41.25rem") !== -1 && style.indexOf("bottom: 0") !== -1;
      if (!hit) return false;
      var title = sheetTitle(el);
      if (!title) return false;
      el.setAttribute("data-vega-sheet", title);
      return true;
    });
    valueDialog = Array.prototype.filter.call(scope.querySelectorAll("div"), function (el) {
      var style = el.getAttribute("style") || "";
      return style.indexOf("display: none") !== -1 && (el.textContent || "").indexOf("Чувствительность MYO") !== -1;
    })[0] || null;
  }

  ensureRoot();
  collectSheets();

  var scrim = document.createElement("div");
  scrim.setAttribute("data-vega-scrim", "1");
  scrim.style.cssText = "display:none;position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:4;";
  document.body.appendChild(scrim);

  var stubDialog = null;

  function hideOverlays() {
    sheets.forEach(function (el) {
      el.style.display = "none";
      el.style.transform = "";
      el.style.transition = "";
    });
    if (valueDialog) valueDialog.style.display = "none";
    if (stubDialog) stubDialog.style.display = "none";
    var devices = document.getElementById("vega-devices");
    if (devices) devices.style.display = "none";
    scrim.style.display = "none";
    scrim.style.opacity = "";
  }

  function fitAdvancedSettingsButton() {
    var label = document.getElementById("34_164");
    if (!label) return;
    label.textContent = "Расширенные настройки";
    label.style.width = "6.6rem";
    label.style.height = "2.4rem";
    label.style.left = "0.5rem";
    label.style.top = "0.75rem";
    label.style.lineHeight = "1.1rem";
    label.style.fontSize = "0.8125rem";
    label.style.whiteSpace = "normal";
    var box = document.getElementById("34_230");
    if (box) {
      box.style.width = "18.75rem";
      box.style.left = "0.625rem";
      box.style.right = "auto";
      box.style.marginLeft = "0";
      box.style.marginRight = "0";
    }
  }

  function overlayMaxHeightPx() {
    var view = window.visualViewport;
    var h = view && view.height ? view.height : window.innerHeight;
    return Math.max(240, Math.round(h * 0.85));
  }

  function ensureSheetScrollSize(el) {
    var sizer = el.querySelector("[data-vega-sheet-sizer]");
    if (!sizer) {
      sizer = document.createElement("div");
      sizer.setAttribute("data-vega-sheet-sizer", "1");
      el.appendChild(sizer);
    }
    // Абсолютная вёрстка шита не даёт scrollHeight — фиксируем высоту макета.
    sizer.style.cssText = "display:block;width:1px;height:41.25rem;pointer-events:none;visibility:hidden;";
  }

  function ensureSheetGrabber(el) {
    var grab = el.querySelector("[data-vega-sheet-grab]");
    if (grab) return grab;
    grab = document.createElement("div");
    grab.setAttribute("data-vega-sheet-grab", "1");
    grab.style.cssText = "position:sticky;top:0;left:0;right:0;z-index:8;height:1.75rem;display:flex;align-items:center;justify-content:center;background:linear-gradient(#fefefe 60%, rgba(254,254,254,0));cursor:pointer;touch-action:none;";
    grab.innerHTML = '<div style="width:2.75rem;height:0.25rem;border-radius:0.125rem;background:rgba(0,0,0,.22);"></div>';
    grab.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      hideOverlays();
    });
    el.insertBefore(grab, el.firstChild);
    return grab;
  }

  function bindSheetSwipe(el) {
    if (el.getAttribute("data-vega-swipe") === "1") return;
    el.setAttribute("data-vega-swipe", "1");
    var drag = null;

    function releaseCapture(id) {
      try { el.releasePointerCapture(id); } catch (err) {}
    }

    function finishHide() {
      el.style.transform = "";
      el.style.transition = "";
      el.style.overflowY = "auto";
      hideOverlays();
    }

    function snapBack() {
      el.style.transition = "transform 0.22s ease-out";
      el.style.transform = "translateY(0)";
      scrim.style.transition = "opacity 0.22s ease-out";
      scrim.style.opacity = "1";
      window.setTimeout(function () {
        el.style.transform = "";
        el.style.transition = "";
        el.style.overflowY = "auto";
        scrim.style.transition = "";
        scrim.style.opacity = "";
      }, 220);
    }

    function dismiss(dy) {
      var h = el.getBoundingClientRect().height || overlayMaxHeightPx();
      el.style.transition = "transform 0.28s ease-out";
      el.style.transform = "translateY(" + Math.max(h, dy) + "px)";
      scrim.style.transition = "opacity 0.28s ease-out";
      scrim.style.opacity = "0";
      window.setTimeout(finishHide, 280);
    }

    el.addEventListener("pointerdown", function (event) {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      var onGrab = !!(event.target && event.target.closest && event.target.closest("[data-vega-sheet-grab]"));
      drag = {
        id: event.pointerId,
        y: event.clientY,
        lastY: event.clientY,
        lastT: Date.now(),
        dy: 0,
        velocity: 0,
        moving: false,
        fromGrab: onGrab,
        startScroll: el.scrollTop
      };
    });

    el.addEventListener("pointermove", function (event) {
      if (!drag || drag.id !== event.pointerId) return;
      var dy = event.clientY - drag.y;
      var now = Date.now();
      var dt = Math.max(1, now - drag.lastT);
      drag.velocity = (event.clientY - drag.lastY) / dt;
      drag.lastY = event.clientY;
      drag.lastT = now;

      // Скролл контента вверх — не перехватываем.
      if (!drag.moving && dy < -6) {
        drag = null;
        return;
      }

      // Шторка: тянем вниз с самого верха или за ручку.
      var canPull = drag.fromGrab || drag.startScroll <= 1 || el.scrollTop <= 1;
      if (!canPull) return;
      if (dy < 8 && !drag.moving) return;

      if (!drag.moving) {
        drag.moving = true;
        drag.y = event.clientY;
        dy = 0;
        el.style.overflowY = "hidden";
        try { el.setPointerCapture(event.pointerId); } catch (err) {}
      }

      if (dy < 0) dy = 0;
      // Лёгкий «резиновый» ход шторки.
      var pull = dy < 120 ? dy : 120 + (dy - 120) * 0.35;
      drag.dy = dy;
      drag.pull = pull;
      el.style.transition = "none";
      el.style.transform = "translateY(" + pull + "px)";
      scrim.style.transition = "none";
      scrim.style.opacity = String(Math.max(0.05, 1 - pull / 380));
      if (event.cancelable) event.preventDefault();
    }, { passive: false });

    function endDrag(event) {
      if (!drag || drag.id !== event.pointerId) return;
      var dy = drag.dy || 0;
      var moving = drag.moving;
      var velocity = drag.velocity || 0;
      releaseCapture(event.pointerId);
      drag = null;
      if (!moving) {
        el.style.overflowY = "auto";
        return;
      }
      var threshold = Math.min(140, overlayMaxHeightPx() * 0.18);
      if (dy > threshold || velocity > 0.7) dismiss(dy);
      else snapBack();
    }

    el.addEventListener("pointerup", endDrag);
    el.addEventListener("pointercancel", endDrag);
  }

  function pinOverlay(el, bottom) {
    if (el.parentElement !== document.body) document.body.appendChild(el);
    el.style.display = "block";
    el.style.position = "fixed";
    el.style.zIndex = "6";
    el.style.left = "0";
    el.style.right = "0";
    el.style.marginLeft = "auto";
    el.style.marginRight = "auto";
    el.style.bottom = bottom;
    el.style.width = "22.5rem";
    el.style.maxWidth = "100%";
    el.style.transform = "";
    el.style.transition = "";
    if (el.getAttribute("data-vega-sheet") || sheets.indexOf(el) !== -1) {
      var maxPx = overlayMaxHeightPx();
      el.style.height = maxPx + "px";
      el.style.maxHeight = maxPx + "px";
      el.style.overflowX = "hidden";
      el.style.overflowY = "auto";
      el.style.webkitOverflowScrolling = "touch";
      el.style.boxSizing = "border-box";
      el.style.paddingBottom = "max(0.75rem, env(safe-area-inset-bottom, 0px))";
      el.style.touchAction = "pan-y";
      ensureSheetScrollSize(el);
      ensureSheetGrabber(el);
      bindSheetSwipe(el);
    }
    scrim.style.display = "block";
    scrim.style.opacity = "";
    scrim.style.transition = "";
  }

  function sharpenDeviceListButton(sheet) {
    var labels = sheet.querySelectorAll("p");
    for (var i = 0; i < labels.length; i++) {
      if (normalize(labels[i].textContent) !== "Список устройств") continue;
      var style = labels[i].getAttribute("style") || "";
      if (style.indexOf("height: 3rem") === -1) continue;
      var shell = labels[i].parentElement && labels[i].parentElement.parentElement;
      if (!shell) continue;
      shell.style.cursor = "pointer";
      shell.style.zIndex = "3";
      var kids = shell.children;
      for (var j = 0; j < kids.length; j++) {
        var kidStyle = kids[j].getAttribute("style") || "";
        if (kidStyle.indexOf("border-style: solid") === -1) continue;
        kids[j].style.zIndex = "2";
        kids[j].style.border = "0.125rem solid #111";
        kids[j].style.boxSizing = "border-box";
        kids[j].style.borderRadius = "0.625rem";
        kids[j].style.pointerEvents = "none";
      }
      if (labels[i].parentElement) labels[i].parentElement.style.pointerEvents = "auto";
    }
  }

  function openSheet(title) {
    var opened = false;
    sheets.forEach(function (el) {
      if (sheetTitle(el) === title || el.getAttribute("data-vega-sheet") === title) {
        pinOverlay(el, "0");
        el.scrollTop = 0;
        if (title === "Информация об устройстве") {
          paintDisStatusButton();
          sharpenDeviceListButton(el);
        }
        opened = true;
      } else {
        el.style.display = "none";
      }
    });
    if (valueDialog) valueDialog.style.display = "none";
    if (stubDialog) stubDialog.style.display = "none";
    if (!opened) scrim.style.display = "none";
  }

  function openValueDialog() {
    if (!valueDialog) return;
    var host = document.getElementById("35_487");
    var caption = document.getElementById("35_488");
    if (host) {
      var field = host.querySelector("[data-vega-number]");
      if (!field) {
        field = document.createElement("input");
        field.setAttribute("data-vega-number", "1");
        field.type = "text";
        field.inputMode = "decimal";
        field.autocomplete = "off";
        field.placeholder = "Пример: 0.4";
        field.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:0;background:transparent;padding:0 1rem;font-size:0.875rem;font-family:Roboto-Regular,sans-serif;color:#222;outline:none;z-index:3;";
        host.appendChild(field);
        bindNumeric(field);
      }
      field.value = "";
      if (caption) caption.style.visibility = "hidden";
      window.setTimeout(function () { field.focus(); }, 0);
    }
    sheets.forEach(function (el) { el.style.display = "none"; });
    if (stubDialog) stubDialog.style.display = "none";
    pinOverlay(valueDialog, "4.5rem");
    valueDialog.style.zIndex = "6";
  }

  function ensureStub() {
    if (stubDialog) return stubDialog;
    var dialog = document.createElement("div");
    dialog.id = "vega-stub";
    dialog.style.cssText = "display:none;width:20.625rem;height:18.75rem;overflow:hidden;border-radius:0.875rem;background:#fefefe;box-shadow:0 0.5rem 1.5rem rgba(0,0,0,.18);";
    dialog.innerHTML = ''
      + '<p data-vega-stub-title style="position:absolute;left:1.625rem;top:1.5rem;width:17.3rem;margin:0;font-size:1.25rem;font-family:Roboto-Medium,sans-serif;font-weight:500;line-height:1.55rem;color:#111;"></p>'
      + '<p data-vega-stub-hint style="position:absolute;left:1.6875rem;top:5.35rem;width:17.25rem;margin:0;font-size:0.75rem;font-family:Roboto-Medium,sans-serif;font-weight:500;line-height:1rem;color:rgb(139,137,137);">Форма в разработке</p>'
      + '<div data-vega-stub-box style="position:absolute;left:1.625rem;top:7.15rem;width:17.375rem;height:2.625rem;border-radius:0.875rem;background:rgba(242,238,238,.6);border:0.125rem solid #dedede;box-sizing:border-box;">'
      + '<p data-vega-stub-placeholder style="position:absolute;left:1rem;top:0.85rem;margin:0;font-size:0.875rem;font-family:Roboto-Regular,sans-serif;color:rgb(139,139,139);"></p>'
      + '<input data-vega-stub-field data-vega-number="1" type="text" inputmode="decimal" autocomplete="off" style="display:none;position:absolute;inset:0;width:100%;height:100%;border:0;background:transparent;padding:0 1rem;font-size:0.875rem;font-family:Roboto-Regular,sans-serif;color:#222;outline:none;z-index:2;"></div>'
      + '<p data-vega-stub-note style="position:absolute;left:1.625rem;top:10.35rem;width:17.25rem;margin:0;font-size:0.75rem;font-family:Roboto-Medium,sans-serif;font-weight:500;color:rgb(139,137,137);">Заглушка, как у параметра в сервисных настройках</p>'
      + '<div data-vega-grip-picks="1" style="display:none;">'
      + '<p style="position:absolute;left:1.625rem;top:6.35rem;margin:0;font-size:0.75rem;font-family:Roboto-Medium,sans-serif;font-weight:500;color:rgb(139,137,137);">Схват 1</p>'
      + '<select data-vega-grip-a style="position:absolute;left:1.625rem;top:7.2rem;width:17.375rem;height:2.625rem;border-radius:0.875rem;border:0.125rem solid #dedede;background:rgba(242,238,238,.6);padding:0 0.75rem;font-size:0.875rem;font-family:Roboto-Regular,sans-serif;color:#222;"></select>'
      + '<p style="position:absolute;left:1.625rem;top:10.05rem;margin:0;font-size:0.75rem;font-family:Roboto-Medium,sans-serif;font-weight:500;color:rgb(139,137,137);">Схват 2</p>'
      + '<select data-vega-grip-b style="position:absolute;left:1.625rem;top:10.9rem;width:17.375rem;height:2.625rem;border-radius:0.875rem;border:0.125rem solid #dedede;background:rgba(242,238,238,.6);padding:0 0.75rem;font-size:0.875rem;font-family:Roboto-Regular,sans-serif;color:#222;"></select>'
      + '</div>'
      + '<div style="position:absolute;left:1.625rem;top:14.15rem;width:7.8125rem;height:3rem;border-radius:0.625rem;background:rgb(55,90,118);cursor:pointer;"><p data-vega-stub-action style="margin:0;height:3rem;display:flex;align-items:center;justify-content:center;font-size:1rem;font-family:Roboto-Bold,sans-serif;font-weight:700;color:#fefefe;">Сохранить</p></div>'
      + '<div style="position:absolute;left:10.5625rem;top:14.15rem;width:7.8125rem;height:3rem;border-radius:0.625rem;background:#fff;border:0.125rem solid #000;box-sizing:border-box;cursor:pointer;"><p style="margin:0;height:3rem;display:flex;align-items:center;justify-content:center;font-size:1rem;font-family:Roboto-Bold,sans-serif;font-weight:700;color:#000;">Отмена</p></div>';
    document.body.appendChild(dialog);
    stubDialog = dialog;
    return dialog;
  }

  function digitsOnly(value) {
    var text = String(value || "").replace(/,/g, ".");
    var out = "";
    var dot = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (ch >= "0" && ch <= "9") out += ch;
      else if (ch === "." && !dot) {
        dot = true;
        out += ch;
      }
    }
    return out;
  }

  function withinSensitivity(text) {
    if (text === "" || text === ".") return true;
    var body = text.charAt(text.length - 1) === "." ? text.slice(0, -1) : text;
    if (body === "") return true;
    var value = parseFloat(body);
    return !isNaN(value) && value >= 0 && value <= 1;
  }

  function cleanUint(text) {
    var digits = String(text || "").replace(/\D/g, "");
    if (!digits) return "";
    var n = parseInt(digits, 10);
    if (isNaN(n) || n > 65535) return null;
    return String(n);
  }

  function bindNumeric(input, mode) {
    input.dataset.vegaMode = mode || "unit";
    if (!input.dataset.vegaLast) input.dataset.vegaLast = "";
    if (input.dataset.vegaBound) return;
    input.dataset.vegaBound = "1";
    function currentMode() { return input.dataset.vegaMode || "unit"; }
    input.addEventListener("beforeinput", function (event) {
      if (!event.data) return;
      if (event.inputType === "insertFromPaste" || event.inputType === "insertFromDrop") return;
      var integer = currentMode() === "u16";
      var i;
      for (i = 0; i < event.data.length; i++) {
        var ch = event.data.charAt(i);
        if (ch >= "0" && ch <= "9") continue;
        if (!integer && (ch === "." || ch === ",")) continue;
        event.preventDefault();
        return;
      }
      var start = input.selectionStart || 0;
      var end = input.selectionEnd || 0;
      var raw = input.value.slice(0, start) + event.data + input.value.slice(end);
      if (integer) {
        if (cleanUint(raw) === null) event.preventDefault();
        return;
      }
      if (!withinSensitivity(digitsOnly(raw))) event.preventDefault();
    });
    input.addEventListener("input", function () {
      var integer = currentMode() === "u16";
      var next = integer ? cleanUint(input.value) : digitsOnly(input.value);
      if (next === null || (!integer && !withinSensitivity(next))) next = input.dataset.vegaLast || "";
      if (input.value !== next) {
        var pos = input.selectionStart || next.length;
        input.value = next;
        var caret = Math.max(0, Math.min(pos, next.length));
        input.setSelectionRange(caret, caret);
      }
      input.dataset.vegaLast = input.value;
    });
  }

  function openStub(title, hint, placeholder, action, note, numeric) {
    var dialog = ensureStub();
    dialog.querySelector("[data-vega-stub-title]").textContent = title;
    dialog.querySelector("[data-vega-stub-hint]").textContent = hint || "Форма в разработке";
    dialog.querySelector("[data-vega-stub-note]").textContent = note || "Заглушка, как у параметра в сервисных настройках";
    dialog.querySelector("[data-vega-stub-action]").textContent = action || "Сохранить";
    var hintText = placeholder || "Пример: 0.4";
    var label = dialog.querySelector("[data-vega-stub-placeholder]");
    var field = dialog.querySelector("[data-vega-stub-field]");
    var mode = numeric === true ? "unit" : (typeof numeric === "string" ? numeric : "");
    dialog.dataset.vegaGrip = "";
    var picks = dialog.querySelector("[data-vega-grip-picks]");
    var box = dialog.querySelector("[data-vega-stub-box]");
    if (picks) picks.style.display = "none";
    if (box) box.style.display = "";
    dialog.querySelector("[data-vega-stub-note]").style.display = "";
    label.textContent = hintText;
    label.style.display = mode ? "none" : "";
    field.style.display = mode ? "block" : "none";
    field.value = "";
    field.placeholder = hintText;
    field.inputMode = mode === "u16" ? "numeric" : "decimal";
    if (mode) bindNumeric(field, mode);
    sheets.forEach(function (el) { el.style.display = "none"; });
    if (valueDialog) valueDialog.style.display = "none";
    pinOverlay(dialog, "4.5rem");
    dialog.style.zIndex = "6";
    dialog.style.transform = "none";
    var avail = (window.innerHeight || document.documentElement.clientHeight) - 5.2 * rootPx();
    var needed = 18.75 * rootPx();
    if (needed > avail && avail > 80) {
      dialog.style.transformOrigin = "center bottom";
      dialog.style.transform = "scale(" + Math.max(0.55, avail / needed).toFixed(3) + ")";
    }
    if (mode) window.setTimeout(function () { field.focus(); }, 0);
    return dialog;
  }

  function gripNames() {
    var names = [];
    var row = document.getElementById("vega-grips");
    if (row) {
      var cards = row.children;
      for (var i = 0; i < cards.length; i++) {
        var text = normalize(cards[i].innerText);
        if (!text || text === "Добавить схват") continue;
        names.push(text);
      }
    }
    return names.length ? names : ["Жест Джамбо", "Жест Коза", "Схват Ключа"];
  }

  function gripChoice() {
    try { return JSON.parse(localStorage.getItem("vega-grip-load") || "{}"); }
    catch (e) { return {}; }
  }

  function fillGripSelect(select, names, chosen) {
    select.innerHTML = "";
    names.forEach(function (name) {
      var option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      select.appendChild(option);
    });
    if (names.indexOf(chosen) !== -1) select.value = chosen;
    else if (names.length) select.value = names[0];
  }

  function openGripLoad() {
    pendingMode = "";
    editingSensor = "";
    var names = gripNames();
    var saved = gripChoice();
    var dialog = openStub("Загрузить схваты", "Выберите два схвата из библиотеки", "", "Отправить", " ", "");
    dialog.dataset.vegaGrip = "1";
    dialog.querySelector("[data-vega-stub-box]").style.display = "none";
    dialog.querySelector("[data-vega-stub-note]").style.display = "none";
    var picks = dialog.querySelector("[data-vega-grip-picks]");
    picks.style.display = "block";
    var fallbackB = names[Math.min(1, names.length - 1)] || "";
    fillGripSelect(picks.querySelector("[data-vega-grip-a]"), names, saved.a || names[0] || "");
    fillGripSelect(picks.querySelector("[data-vega-grip-b]"), names, saved.b || fallbackB);
  }

  function saveGripLoad() {
    var dialog = document.getElementById("vega-stub");
    if (!dialog || dialog.dataset.vegaGrip !== "1") return;
    var a = dialog.querySelector("[data-vega-grip-a]");
    var b = dialog.querySelector("[data-vega-grip-b]");
    try { localStorage.setItem("vega-grip-load", JSON.stringify({ a: a.value, b: b.value })); }
    catch (e) {}
    dialog.dataset.vegaGrip = "";
  }

  function rootPx() {
    return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  }

  function inRem(rect) {
    var px = rootPx();
    return { w: rect.width / px, h: rect.height / px };
  }

  function routeOf(node) {
    if (!node || node.nodeType !== 1) return "";
    var file = ROUTES[normalize(node.innerText)];
    if (!file) return "";
    var box = inRem(node.getBoundingClientRect());
    if (box.w < 0.5 || box.h < 0.5 || box.h > 12 || box.w > 22.5) return "";
    return file;
  }

  function findRoute(target) {
    var node = target;
    while (node && node !== document.body) {
      var file = routeOf(node);
      if (file) return file;
      node = node.parentElement;
    }
    return "";
  }

  function isUpButton(target) {
    var node = target;
    while (node && node !== document.body) {
      if (node.getAttribute && node.getAttribute("data-vega-up") === "1") return true;
      var style = node.getAttribute("style") || "";
      if (style.indexOf("width: 3.875rem") !== -1 && style.indexOf("height: 3.875rem") !== -1) return true;
      node = node.parentElement;
    }
    return false;
  }

  function hideIconBesideNotification() {
    var nodes = document.querySelectorAll("div");
    for (var i = 0; i < nodes.length; i++) {
      var style = nodes[i].getAttribute("style") || "";
      if (style.indexOf("d4fcacf4ac2660b0476c8408d717a0b3db741651") === -1) continue;
      var shell = nodes[i];
      while (shell && shell !== document.body) {
        var shellStyle = shell.getAttribute("style") || "";
        if (shellStyle.indexOf("width: 3.125rem") !== -1 && shellStyle.indexOf("height: 3.1875rem") !== -1) {
          shell.style.display = "none";
          break;
        }
        shell = shell.parentElement;
      }
    }
  }

  function pinUpButton(button) {
    button.setAttribute("data-vega-up", "1");
    button.style.position = "fixed";
    button.style.zIndex = "3";
    button.style.top = "auto";
    button.style.left = "auto";
    button.style.margin = "0";
    button.style.bottom = "5.15rem";
    button.style.right = "max(0.875rem, calc((100vw - 22.5rem) / 2 + 0.875rem))";
    button.style.cursor = "pointer";
  }

  function ensureUpButton() {
    var nodes = document.querySelectorAll("div");
    var found = null;
    for (var i = 0; i < nodes.length; i++) {
      var style = nodes[i].getAttribute("style") || "";
      if (style.indexOf("width: 3.875rem") === -1 || style.indexOf("height: 3.875rem") === -1) continue;
      if (!found) found = nodes[i];
      else nodes[i].style.display = "none";
    }
    if (!found) {
      found = document.createElement("div");
      found.style.width = "3.875rem";
      found.style.height = "3.875rem";
      found.style.backgroundImage = "url(./image/Frame_34_225.svg)";
      found.style.backgroundSize = "100% 100%";
      found.style.backgroundRepeat = "no-repeat";
      document.body.appendChild(found);
    }
    pinUpButton(found);
    syncUpButton();
    if (!document.body.dataset.vegaUpSync) {
      document.body.dataset.vegaUpSync = "1";
      document.addEventListener("scroll", syncUpButton, true);
      window.addEventListener("resize", syncUpButton);
      window.setInterval(syncUpButton, 250);
    }
  }

  function syncUpButton() {
    var button = document.querySelector("[data-vega-up]");
    if (!button) return;
    var br = button.getBoundingClientRect();
    var cover = false;
    ["34_834", "34_868"].forEach(function (id) {
      var icon = document.getElementById(id);
      if (!icon) return;
      var r = icon.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      if (br.left < r.right && br.right > r.left && br.top < r.bottom && br.bottom > r.top) cover = true;
    });
    var badges = document.querySelectorAll("[data-vega-param-value]");
    for (var i = 0; i < badges.length; i++) {
      var box = badges[i].getBoundingClientRect();
      if (box.width < 1 || box.height < 1) continue;
      if (br.left < box.right && br.right > box.left && br.top < box.bottom && br.bottom > box.top) cover = true;
    }
    button.style.visibility = cover ? "hidden" : "";
  }

  function isDeviceCard(target) {
    var node = target;
    while (node && node !== document.body) {
      if (node.id === "34_168") return true;
      node = node.parentElement;
    }
    return false;
  }

  function inServiceParams(target) {
    var node = target;
    while (node && node !== document.body) {
      var style = node.getAttribute("style") || "";
      if (style.indexOf("height: 45rem") !== -1) return true;
      node = node.parentElement;
    }
    return false;
  }

  var SERVICE_PARAMS = [
    { id: "35_402", key: "dir_treshold", def: 105, name: "Порог отсечки миосигнала" },
    { id: "35_403", key: "TrigPercentTreshold", def: 2, name: "Порог триггера по абсолютной разнице" },
    { id: "35_404", key: "TriggerBlocks", def: 50, name: "Значение триггера, блок. движение" },
    { id: "35_429", key: "TrigTresholdHigh", def: 945, name: "Верхний порог триггера" },
    { id: "35_413", key: "TrigTresholdLow", def: 819, name: "Нижний порог триггера" },
    { id: "35_416", key: "DifTriggerPlus", def: 50, name: "Скорость роста триггера" },
    { id: "35_418", key: "DifTriggerMinus", def: 6, name: "Скорость падения триггера" },
    { id: "35_449", key: "TrigDelayMax", def: 945, name: "Максимальная задержка триигера" },
    { id: "35_450", key: "DifTrDelayMinus", def: 1, name: "Скорость уменьшения задержки" },
    { id: "35_442", key: "DifMovePlus", def: 3, name: "Скорость увеличения движения" },
    { id: "35_444", key: "DifMoveMinus", def: 2, name: "Скорость уменьшения движения" },
    { id: "35_446", key: "MoveTresholdHigh", def: 315, name: "Макс. значение переменной движения" },
    { id: "35_452", key: "MoveBlocks", def: 20, name: "Значение move, блокирующее триггеры" },
    { id: "35_454", key: "dead_Zone_Myo1", def: 250, name: "Зона нечувствительности MYO-1" },
    { id: "35_456", key: "dead_Zone_Myo2", def: 250, name: "Зона нечувствительности MYO-2" }
  ];
  var SERVICE_BY_ID = {};
  SERVICE_PARAMS.forEach(function (spec) { SERVICE_BY_ID[spec.id] = spec; });
  var editingParam = null;
  var PARAM_STORE = "vega-myo-advanced";

  function loadParams() {
    var saved = {};
    try { saved = JSON.parse(sessionStorage.getItem(PARAM_STORE) || "{}"); } catch (e) { saved = {}; }
    var values = {};
    SERVICE_PARAMS.forEach(function (spec) {
      var n = parseInt(saved[spec.key], 10);
      values[spec.key] = isNaN(n) || n < 0 || n > 65535 ? spec.def : n;
    });
    return values;
  }

  function storeParams(values) {
    sessionStorage.setItem(PARAM_STORE, JSON.stringify(values));
    paintParamValues();
  }

  function paintParamValues() {
    var values = loadParams();
    SERVICE_PARAMS.forEach(function (spec) {
      var row = document.getElementById(spec.id);
      if (!row) return;
      var name = row.querySelector("[data-vega-param-name]");
      var badge = row.querySelector("[data-vega-param-value]");
      if (!name) {
        row.textContent = "";
        row.style.display = "flex";
        row.style.flexDirection = "row";
        row.style.alignItems = "center";
        row.style.justifyContent = "space-between";
        row.style.width = "18.75rem";
        row.style.cursor = "pointer";
        name = document.createElement("span");
        name.setAttribute("data-vega-param-name", "1");
        name.textContent = spec.name;
        name.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1 1 auto;";
        badge = document.createElement("span");
        badge.setAttribute("data-vega-param-value", "1");
        badge.style.cssText = "flex:0 0 auto;margin-left:0.75rem;font-family:Roboto-Bold,sans-serif;font-weight:700;color:rgb(55,90,118);";
        row.appendChild(name);
        row.appendChild(badge);
      }
      badge.textContent = String(values[spec.key]);
    });
  }

  function serviceParamRow(target) {
    var node = target;
    while (node && node !== document.body) {
      if (node.id && SERVICE_BY_ID[node.id]) return node;
      node = node.parentElement;
    }
    return null;
  }

  function openParam(row) {
    var spec = SERVICE_BY_ID[row.id];
    if (!spec) return;
    var current = String(loadParams()[spec.key]);
    openStub(spec.name, "Введите целое значение", "Например: " + spec.def, "Сохранить", "Диапазон значений: 0 ... 65535", "u16");
    editingParam = spec.key;
    pendingMode = "";
    editingSensor = "";
    var field = document.querySelector("#vega-stub [data-vega-stub-field]");
    field.value = current;
    field.dataset.vegaLast = current;
  }

  function saveParam() {
    var field = document.querySelector("#vega-stub [data-vega-stub-field]");
    var cleaned = field ? cleanUint(field.value) : null;
    if (!editingParam || cleaned === null || cleaned === "") return;
    var values = loadParams();
    values[editingParam] = parseInt(cleaned, 10);
    editingParam = null;
    storeParams(values);
    hideOverlays();
    bleRequest({ cmd: "write_myo", values: values });
  }

  function resetParams() {
    var values = {};
    SERVICE_PARAMS.forEach(function (spec) { values[spec.key] = spec.def; });
    editingParam = null;
    storeParams(values);
    hideOverlays();
    bleRequest({ cmd: "write_myo", values: values });
  }

  var SERVICE_PASSWORD = "193409";
  var devOpen = true;
  var serviceScrolled = false;
  var FINGERS = ["Большой палец", "Указательный палец", "Средний палец", "Безымянный палец", "Мизинец"];

  function serviceUnlocked() {
    return sessionStorage.getItem("vega-service") === "1";
  }

  function initPassword() {
    var hint = document.getElementById("35_790");
    var box = document.getElementById("35_789");
    if (!hint || !box || box.querySelector("input")) return;
    hint.style.display = "none";
    var input = document.createElement("input");
    input.setAttribute("data-vega-password", "1");
    input.type = "password";
    input.inputMode = "numeric";
    input.placeholder = "Пароль";
    input.autocomplete = "off";
    input.maxLength = 12;
    input.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:0;background:transparent;padding:0 1.25rem;font-size:0.875rem;font-family:Roboto-Regular,sans-serif;color:#222;z-index:2;outline:none;";
    box.appendChild(input);
    input.addEventListener("input", function () {
      var err = box.querySelector("[data-vega-pass-error]");
      if (err) err.remove();
      box.style.boxShadow = "";
    });
    input.addEventListener("keydown", function (event) {
      if (event.key !== "Enter") return;
      event.preventDefault();
      submitPassword();
    });
  }

  function submitPassword() {
    var input = document.querySelector("[data-vega-password]");
    var box = document.getElementById("35_789");
    if (!input || !box) return;
    if (input.value.trim() === SERVICE_PASSWORD) {
      sessionStorage.setItem("vega-service", "1");
      go("Setting.html#service");
      return;
    }
    var err = box.querySelector("[data-vega-pass-error]");
    if (!err) {
      err = document.createElement("p");
      err.setAttribute("data-vega-pass-error", "1");
      err.textContent = "Неверный пароль";
      err.style.cssText = "position:absolute;left:0.25rem;top:2.9rem;margin:0;font-size:0.75rem;font-family:Roboto-Medium,sans-serif;font-weight:500;color:#b42318;z-index:3;width:12rem;";
      box.appendChild(err);
    }
    box.style.boxShadow = "0 0 0 0.125rem #b42318";
    input.focus();
  }

  function wrapDevChevron() {
    var right = document.getElementById("35_461");
    var left = document.getElementById("35_462");
    if (!right || !left || document.getElementById("vega-dev-chevron")) return;
    var wrap = document.createElement("div");
    wrap.id = "vega-dev-chevron";
    wrap.style.cssText = "position:absolute;left:18.8975rem;top:1.0216rem;width:1.0662rem;height:0.6676rem;transform-origin:center center;";
    right.parentElement.appendChild(wrap);
    wrap.appendChild(left);
    wrap.appendChild(right);
    left.style.left = "0";
    left.style.top = "0.0354rem";
    right.style.left = "0.5018rem";
    right.style.top = "0";
  }

  function ensureExitButton() {
    var reset = document.getElementById("35_473");
    if (!reset || document.getElementById("vega-service-exit")) return;
    var button = document.createElement("div");
    button.id = "vega-service-exit";
    button.style.cssText = "position:absolute;left:-5.6875rem;right:5.6875rem;width:9.375rem;height:3.3125rem;margin-left:auto;margin-right:auto;cursor:pointer;";
    var face = document.createElement("div");
    face.style.cssText = "position:absolute;inset:0;border-radius:0.875rem;background:#fff;border:0.125rem solid #000;box-sizing:border-box;";
    var label = document.createElement("p");
    label.textContent = "Выйти из сервисного режима";
    label.style.cssText = "position:absolute;left:0.4rem;right:0.4rem;top:0.35rem;bottom:0.35rem;margin:0;display:flex;align-items:center;justify-content:center;text-align:center;font-size:0.875rem;font-family:Roboto-Medium,sans-serif;font-weight:500;letter-spacing:0.0156rem;line-height:1.05rem;color:rgba(0,0,0,.8);";
    button.appendChild(face);
    button.appendChild(label);
    reset.parentElement.appendChild(button);
  }

  function ensureProsthesisModeRow() {
    var host = document.getElementById("35_468");
    if (!host || document.getElementById("vega-mode-service")) return;
    var row = document.createElement("p");
    row.id = "vega-mode-service";
    row.textContent = "Сервисный режим протеза";
    row.style.cssText = "font-size:0.875rem;font-family:Roboto-Medium,sans-serif;font-weight:500;text-align:left;display:flex;flex-direction:column;justify-content:center;letter-spacing:0.0156rem;line-height:1.1rem;color:#000;width:19.25rem;height:1.75rem;position:absolute;left:1.1875rem;top:9.25rem;cursor:pointer;";
    host.appendChild(row);
  }

  function exitServiceMode() {
    sessionStorage.removeItem("vega-service");
    if (window.location.hash === "#service") {
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    layoutService();
    [document.scrollingElement, document.documentElement, document.body].forEach(function (el) {
      if (el && typeof el.scrollTo === "function") el.scrollTo({ top: 0, behavior: "smooth" });
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function layoutService() {
    var art = document.getElementById("35_244");
    var title = document.getElementById("35_408");
    var block = document.getElementById("35_410");
    var dev = document.getElementById("35_468");
    var bg = document.getElementById("35_458");
    var reset = document.getElementById("35_473");
    var header = document.getElementById("35_459");
    var exitBtn = document.getElementById("vega-service-exit");
    if (!art || !title || !block || !dev || !reset) return;
    var authed = serviceUnlocked();
    title.style.display = authed ? "" : "none";
    block.style.display = authed ? "" : "none";
    dev.style.display = authed ? "" : "none";
    reset.style.display = authed ? "" : "none";
    if (exitBtn) exitBtn.style.display = authed ? "" : "none";
    if (!authed) {
      art.style.height = "28rem";
      return;
    }
    var collapse = devOpen ? 0 : 9;
    var modeRow = document.getElementById("vega-mode-service");
    dev.style.top = "76.625rem";
    dev.style.height = (devOpen ? 11.625 : 2.625) + "rem";
    dev.style.overflow = "hidden";
    if (bg) bg.style.height = (devOpen ? 11.625 : 2.625) + "rem";
    ["35_469", "35_470", "35_471"].forEach(function (id) {
      var row = document.getElementById(id);
      if (row) row.style.display = devOpen ? "" : "none";
    });
    if (modeRow) modeRow.style.display = devOpen ? "flex" : "none";
    reset.style.top = (89.75 - collapse) + "rem";
    if (exitBtn) exitBtn.style.top = (94.0625 - collapse) + "rem";
    art.style.height = (108.25 - collapse) + "rem";
    if (header) header.style.cursor = "pointer";
    var chevron = document.getElementById("vega-dev-chevron");
    if (chevron) chevron.style.transform = devOpen ? "" : "rotate(180deg)";
    if (!serviceScrolled && window.location.hash === "#service") {
      serviceScrolled = true;
      window.setTimeout(function () {
        title.scrollIntoView({ block: "start" });
      }, 50);
    }
  }

  function devHeaderHit(target) {
    var header = document.getElementById("35_459");
    return !!(header && header.contains(target));
  }

  function editorBar(target) {
    var node = target;
    while (node && node !== document.body) {
      var style = node.getAttribute("style") || "";
      if (style.indexOf("width: 18.25rem") !== -1 && style.indexOf("height: 2.625rem") !== -1 && style.indexOf("rgba(195, 222, 244") !== -1) {
        var parent = node.parentElement;
        var parentStyle = parent ? (parent.getAttribute("style") || "") : "";
        if (parentStyle.indexOf("width: 18.25rem") !== -1 && parentStyle.indexOf("height: 2.625rem") !== -1) return parent;
        return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  function closeMenus() {
    var menus = document.querySelectorAll("[data-vega-menu]");
    for (var i = 0; i < menus.length; i++) {
      var bar = menus[i].parentElement;
      var card = bar && bar.parentElement;
      if (card) card.style.zIndex = "";
      var chev = bar && bar.querySelector("[data-vega-chevron]");
      if (chev) chev.style.transform = "";
      menus[i].remove();
    }
  }

  function openFingerMenu(bar) {
    var label = bar.querySelector("p");
    var current = label ? normalize(label.textContent) : "";
    var menu = document.createElement("div");
    menu.setAttribute("data-vega-menu", "1");
    menu.style.cssText = "position:absolute;left:0;right:0;top:calc(100% + 0.25rem);z-index:9;background:#fff;border-radius:0.625rem;box-shadow:0 0.35rem 1rem rgba(0,0,0,.18);overflow:hidden;";
    FINGERS.forEach(function (name) {
      var item = document.createElement("button");
      item.type = "button";
      item.textContent = name;
      item.style.cssText = "display:block;width:100%;text-align:left;border:0;border-bottom:0.0625rem solid #eee;background:" + (name === current ? "rgba(195,222,244,.55)" : "#fff") + ";padding:0.7rem 0.875rem;font-size:0.875rem;font-family:Roboto-Medium,sans-serif;font-weight:500;color:#222;cursor:pointer;";
      item.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        if (label) label.textContent = name;
        closeMenus();
      });
      menu.appendChild(item);
    });
    bar.appendChild(menu);
    if (bar.parentElement) bar.parentElement.style.zIndex = "8";
    var chev = bar.querySelector("div[style*='height: 0.6661rem']");
    if (chev) {
      chev.setAttribute("data-vega-chevron", "1");
      chev.style.transformOrigin = "center";
      chev.style.transform = "rotate(180deg)";
    }
  }

  function sideLabels(track) {
    var card = track.parentElement;
    if (!card) return [];
    var trackRect = track.getBoundingClientRect();
    var mid = trackRect.top + trackRect.height / 2;
    var limit = 1.8 * rootPx();
    var found = [];
    var nodes = card.querySelectorAll("p");
    for (var i = 0; i < nodes.length; i++) {
      var text = normalize(nodes[i].textContent);
      if (!text || text.length > 18) continue;
      var rect = nodes[i].getBoundingClientRect();
      if (Math.abs(rect.top + rect.height / 2 - mid) > limit) continue;
      found.push(nodes[i]);
    }
    found.sort(function (a, b) {
      return a.getBoundingClientRect().left - b.getBoundingClientRect().left;
    });
    return found.slice(0, 2);
  }

  function bindSwitches() {
    var nodes = document.querySelectorAll("div");
    for (var i = 0; i < nodes.length; i++) {
      var style = nodes[i].getAttribute("style") || "";
      if (style.indexOf("width: 3.3125rem") === -1 || style.indexOf("height: 1.75rem") === -1) continue;
      var track = nodes[i];
      var thumb = track.nextElementSibling;
      if (!thumb) continue;
      var thumbStyle = thumb.getAttribute("style") || "";
      if (thumbStyle.indexOf("width: 1.25rem") === -1 || thumbStyle.indexOf("height: 1.25rem") === -1) continue;
      bindSwitch(track, thumb);
    }
  }

  function bindSwitch(track, thumb) {
    var labels = sideLabels(track);
    var drag = { moved: false, x: 0 };
    track.style.cursor = "pointer";
    track.style.touchAction = "none";
    thumb.style.cursor = "pointer";
    thumb.style.touchAction = "none";
    thumb.style.zIndex = "2";

    function paint(toRight) {
      var active = "rgba(34, 34, 34, 1)";
      var idle = "rgba(179, 172, 172, 1)";
      if (labels[0]) labels[0].style.color = toRight ? idle : active;
      if (labels[1]) labels[1].style.color = toRight ? active : idle;
    }

    function setSide(toRight) {
      var parent = thumb.parentElement;
      var parentRect = parent.getBoundingClientRect();
      var trackRect = track.getBoundingClientRect();
      var thumbRect = thumb.getBoundingClientRect();
      var px = rootPx();
      var pad = 0.12 * px;
      var x = toRight ? trackRect.right - parentRect.left - thumbRect.width - pad : trackRect.left - parentRect.left + pad;
      var y = thumbRect.top - parentRect.top;
      thumb.dataset.vegaSide = toRight ? "right" : "left";
      thumb.style.left = (x / px) + "rem";
      thumb.style.right = "auto";
      thumb.style.top = (y / px) + "rem";
      thumb.style.bottom = "auto";
      thumb.style.margin = "0";
      paint(toRight);
    }

    setSide(false);
    labels.forEach(function (label, index) {
      label.style.cursor = "pointer";
      label.addEventListener("click", function (event) {
        event.stopPropagation();
        setSide(index === 1);
      });
    });
    thumb.addEventListener("pointerdown", function (event) {
      drag.moved = false;
      drag.x = event.clientX;
      thumb.setPointerCapture(event.pointerId);
    });
    thumb.addEventListener("pointermove", function (event) {
      if (!thumb.hasPointerCapture(event.pointerId)) return;
      if (Math.abs(event.clientX - drag.x) > 4) drag.moved = true;
      var rect = track.getBoundingClientRect();
      setSide(event.clientX >= rect.left + rect.width / 2);
    });
    function toggle(event) {
      event.stopPropagation();
      if (drag.moved) {
        drag.moved = false;
        return;
      }
      setSide(thumb.dataset.vegaSide !== "right");
    }
    thumb.addEventListener("click", toggle);
    track.addEventListener("click", function (event) {
      if (event.target === thumb) return;
      toggle(event);
    });
  }

  function isCheckShell(el) {
    if (!el || el.nodeType !== 1) return false;
    var style = el.getAttribute("style") || "";
    if (style.indexOf("width: 1.375rem") === -1 || style.indexOf("height: 1.375rem") === -1) return false;
    if ((style + el.innerHTML).indexOf("border-radius: 0.5rem") === -1) return false;
    return true;
  }

  function checkMark(shell) {
    var ready = shell.querySelector("[data-vega-check]");
    if (ready) return ready;
    var scope = shell.parentElement || shell;
    var nodes = scope.querySelectorAll("div");
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i] === shell) continue;
      var style = nodes[i].getAttribute("style") || "";
      var box = nodes[i].getBoundingClientRect();
      var host = shell.getBoundingClientRect();
      var near = shell.contains(nodes[i]) || Math.abs(box.left - host.left) < 12;
      if (!near) continue;
      if (style.indexOf("Rectangle19") !== -1 || (style.indexOf("width: 1rem") !== -1 && style.indexOf("55.451183") !== -1)) {
        nodes[i].setAttribute("data-vega-check", "1");
        return nodes[i];
      }
    }
    var mark = document.createElement("div");
    mark.setAttribute("data-vega-check", "1");
    mark.style.cssText = "display:none;position:absolute;left:0.1875rem;top:0.1875rem;width:1rem;height:1rem;border-radius:0.375rem;background:rgb(55,90,118);border:0.125rem solid rgb(214,229,246);box-sizing:border-box;z-index:2;";
    shell.appendChild(mark);
    return mark;
  }

  function setChecked(shell, on) {
    var mark = checkMark(shell);
    mark.style.display = on ? "block" : "none";
    shell.dataset.vegaChecked = on ? "1" : "0";
    if (on) {
      mark.classList.remove("vega-mark-in");
      void mark.offsetWidth;
      mark.classList.add("vega-mark-in");
    }
  }

  function bindOneCheck(shell) {
    var mark = checkMark(shell);
    var shown = !!mark.getAttribute("style") && mark.style.display !== "none" && getComputedStyle(mark).display !== "none";
    shell.dataset.vegaChecked = shown ? "1" : "0";
    if (!shown) mark.style.display = "none";
    var row = shell.parentElement;
    var host = row && inRem(row.getBoundingClientRect()).h < 4 ? row : shell;
    host.style.cursor = "pointer";
    host.addEventListener("click", function (event) {
      event.stopPropagation();
      setChecked(shell, shell.dataset.vegaChecked !== "1");
    });
  }

  function bindChecks() {
    var nodes = document.querySelectorAll("div");
    for (var i = 0; i < nodes.length; i++) {
      if (!isCheckShell(nodes[i]) || isCheckShell(nodes[i].parentElement)) continue;
      bindOneCheck(nodes[i]);
    }
  }

  function paintChip(chip, on) {
    var label = chip.querySelector("p");
    if (!chip.dataset.vegaBg) {
      chip.dataset.vegaBg = getComputedStyle(chip).backgroundColor;
      if (label) chip.dataset.vegaColor = getComputedStyle(label).color;
    }
    chip.dataset.vegaOff = on ? "0" : "1";
    if (on) {
      var idle = (chip.dataset.vegaBg || "").indexOf("254") !== -1;
      chip.style.backgroundColor = idle ? "rgb(55,90,118)" : chip.dataset.vegaBg;
      if (label) label.style.color = idle ? "#fefefe" : chip.dataset.vegaColor;
    } else {
      chip.style.backgroundColor = "#e6e6e6";
      if (label) label.style.color = "#888";
    }
    paintAxis();
  }

  function chipOn(id) {
    var el = document.getElementById(id);
    if (!el) return false;
    if (el.dataset.vegaOff) return el.dataset.vegaOff !== "1";
    return (el.getAttribute("style") || "").indexOf("254, 254, 254") === -1;
  }

  var chartWindowSec = 10;
  var TIME_AXIS_IDS = ["34_809", "34_810", "34_811", "34_812", "34_813", "34_814", "34_816"];

  function paintAxis() {
    var top = document.getElementById("34_806");
    if (!top) return;
    var max = chipOn("34_804") ? 10 : 5;
    var mid = document.getElementById("34_808");
    var bot = document.getElementById("34_807");
    top.textContent = String(max);
    if (mid) mid.textContent = String(max / 2);
    if (bot) bot.textContent = "0";
    paintTimeAxis(chartWindowSec);
  }

  function paintTimeAxis(seconds) {
    var sec = Number(seconds) || 10;
    chartWindowSec = sec;
    var count = TIME_AXIS_IDS.length;
    for (var i = 0; i < count; i++) {
      var el = document.getElementById(TIME_AXIS_IDS[i]);
      if (!el) continue;
      var raw = sec * (i + 1) / count;
      var value = sec <= 5 ? Math.round(raw * 10) / 10 : Math.round(raw);
      el.textContent = String(value);
    }
  }

  function selectTime(name) {
    var labels = document.querySelectorAll("p");
    for (var i = 0; i < labels.length; i++) {
      var text = normalize(labels[i].textContent);
      if (text !== "5 сек" && text !== "10 сек" && text !== "30 сек") continue;
      var chip = labels[i].parentElement;
      if (!chip) continue;
      var on = text === name;
      chip.style.backgroundColor = on ? "rgb(55,90,118)" : "#fefefe";
      labels[i].style.color = on ? "#fefefe" : "rgb(70,68,68)";
    }
    var sec = name === "5 сек" ? 5 : name === "30 сек" ? 30 : 10;
    paintTimeAxis(sec);
  }

  function chipOf(target) {
    var node = target;
    while (node && node !== document.body) {
      var style = node.getAttribute("style") || "";
      if (style.indexOf("height: 2.375rem") !== -1 && style.indexOf("width: 4.5625rem") !== -1 && style.indexOf("border-radius: 0.875rem") !== -1) return node;
      node = node.parentElement;
    }
    return null;
  }

  function bindTrigger() {
    var dot = document.getElementById("34_815");
    if (!dot) return;
    dot.style.backgroundImage = "none";
    dot.style.backgroundColor = "rgb(180,180,180)";
    dot.style.borderRadius = "50%";
  }

  function docCard(start) {
    var node = start && start.nodeType === 1 ? start : start && start.parentElement;
    while (node && node !== document.body) {
      var style = node.getAttribute("style") || "";
      if (style.indexOf("width: 6.125rem") !== -1 && style.indexOf("height: 10.625rem") !== -1) {
        var text = normalize(node.innerText);
        if (text.indexOf("О программе") !== -1 || text.indexOf("О протезах") !== -1) return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  function bindDocCards() {
    var nodes = document.querySelectorAll("div");
    for (var i = 0; i < nodes.length; i++) {
      if (docCard(nodes[i]) !== nodes[i]) continue;
      nodes[i].style.cursor = "pointer";
    }
  }

  function addProfileCard(start) {
    var node = start && start.nodeType === 1 ? start : start && start.parentElement;
    while (node && node !== document.body) {
      var style = node.getAttribute("style") || "";
      if (style.indexOf("width: 20rem") !== -1 && style.indexOf("height: 13.125rem") !== -1 && normalize(node.innerText).indexOf("Добавить профиль протеза") !== -1) return node;
      node = node.parentElement;
    }
    return null;
  }

  var PRESS_LABELS = {
    "Отмена": 1,
    "Сохранить": 1,
    "Вход": 1,
    "Выйти из сервисного режима": 1,
    "Загрузить схваты": 1,
    "Сброс настроек": 1,
    "Обновить настройки протеза": 1,
    "Добавить документ": 1,
    "Добавить профиль протеза": 1,
    "5 сек": 1,
    "10 сек": 1,
    "30 сек": 1,
    "MYO-1": 1,
    "MYO-2": 1,
    "АКБ": 1,
    "Жест Коза": 1,
    "Жест Джамбо": 1,
    "Схват Ключа": 1,
    "Список устройств": 1,
    "Выбрать": 1,
    "Отключить": 1,
    "Отправить": 1,
    "Пользовательский режим": 1,
    "Сервисный режим протеза": 1,
    "Расширенные настройки": 1,
    "Персонализация": 1,
    "Параметры устройств": 1,
    "Параметры беспроводной связи": 1,
    "Лицензионные соглашения": 1
  };

  function pencilOf(start) {
    var node = start && start.nodeType === 1 ? start : start && start.parentElement;
    while (node && node !== document.body) {
      var style = node.getAttribute("style") || "";
      if (style.indexOf("e27625e41c74b6e9f26c7b45f6bc05395977f62c") !== -1) {
        var card = node.parentElement;
        if (card && (card.id === "34_861" || card.id === "34_862")) return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  function pencilSensor(pencil) {
    var text = pencil && pencil.parentElement ? pencil.parentElement.innerText : "";
    if (text.indexOf("MYO-2") !== -1) return "2";
    if (text.indexOf("MYO-1") !== -1) return "1";
    return "";
  }

  function bindPencils() {
    ["34_834", "34_868"].forEach(function (id) {
      var icon = document.getElementById(id);
      if (icon) icon.style.cursor = "pointer";
    });
  }

  function bindSettingsRows() {
    var host = document.getElementById("35_395");
    if (!host) return;
    var rows = host.querySelectorAll("p");
    for (var i = 0; i < rows.length; i++) rows[i].style.cursor = "pointer";
  }

  function headerIconInfo(start) {
    var node = start && start.nodeType === 1 ? start : start && start.parentElement;
    var shell = null;
    var kind = "";
    while (node && node !== document.body) {
      var style = node.getAttribute("style") || "";
      if (style.indexOf("048714f41f6a2ee43d002635a94f596ed8f94b7c") !== -1) kind = "ble";
      if (style.indexOf("953999f3aefcce454ce665b5493f1ae4d5842efd") !== -1) kind = "bell";
      if (style.indexOf("width: 3.125rem") !== -1 && style.indexOf("height: 3.1875rem") !== -1) shell = node;
      node = node.parentElement;
    }
    return kind && shell ? { shell: shell, kind: kind } : null;
  }

  function headerIcon(start) {
    var info = headerIconInfo(start);
    return info ? info.shell : null;
  }

  function isDisStatusHit(target) {
    var node = target;
    while (node && node !== document.body) {
      if (node.getAttribute && node.getAttribute("data-vega-dis-status") === "1") return true;
      if (node.id && DIS_STATUS_BTNS.indexOf(node.id) !== -1) return true;
      node = node.parentElement;
    }
    return false;
  }

  function isSheetGrabHit(target) {
    var node = target;
    while (node && node !== document.body) {
      if (node.getAttribute && node.getAttribute("data-vega-sheet-grab") === "1") return true;
      var style = node.getAttribute && node.getAttribute("style") || "";
      if (style.indexOf("height: 0.1875rem") !== -1 && style.indexOf("width: 2.8125rem") !== -1) return true;
      node = node.parentElement;
    }
    return false;
  }

  function bindHeaderIcons() {
    var nodes = document.querySelectorAll("div");
    for (var i = 0; i < nodes.length; i++) {
      var icon = headerIcon(nodes[i]);
      if (icon) icon.style.cursor = "pointer";
    }
  }

  function pressTarget(start) {
    var node = start && start.nodeType === 1 ? start : start && start.parentElement;
    var pencil = pencilOf(node);
    if (pencil) return pencil;
    var icon = headerIcon(node);
    if (icon) return icon;
    var card = docCard(node);
    if (card) return card;
    var profileCard = addProfileCard(node);
    if (profileCard) return profileCard;
    var best = null;
    while (node && node !== document.body) {
      if (node.hasAttribute && node.hasAttribute("data-vega-scrim")) return null;
      if (node.id === "vega-stub") break;
      if (isCheckShell(node) && !isCheckShell(node.parentElement)) return node;
      if (node.getAttribute && node.getAttribute("data-vega-up") === "1") return node;
      if (node.tagName === "BUTTON") return node;
      var style = node.getAttribute("style") || "";
      if (style.indexOf("pointer-events: none") !== -1) {
        node = node.parentElement;
        continue;
      }
      if (style.indexOf("width: 3.875rem") !== -1 && style.indexOf("height: 3.875rem") !== -1) return node;
      if (style.indexOf("width: 3.625rem") !== -1 && style.indexOf("height: 3.625rem") !== -1) return node;
      if (style.indexOf("width: 4.5625rem") !== -1 && style.indexOf("height: 2.375rem") !== -1) return node;
      if (style.indexOf("width: 3.3125rem") !== -1 && style.indexOf("height: 1.75rem") !== -1) return node;
      if (style.indexOf("width: 1.25rem") !== -1 && style.indexOf("height: 1.25rem") !== -1 && node.previousElementSibling) {
        var prevStyle = node.previousElementSibling.getAttribute("style") || "";
        if (prevStyle.indexOf("width: 3.3125rem") !== -1 && prevStyle.indexOf("height: 1.75rem") !== -1) return node.previousElementSibling;
      }
      if (node.id === "35_459") return node;
      var box = inRem(node.getBoundingClientRect());
      var text = normalize(node.innerText);
      var known = (ROUTES[text] || PRESS_LABELS[text]) && box.w >= 1.2 && box.w <= 22.6 && box.h >= 1.2 && box.h <= 12;
      var serviceRow = inServiceParams(node) && node.tagName === "P" && box.w >= 8 && box.h >= 1.2 && box.h <= 3;
      if (known || serviceRow) best = node;
      node = node.parentElement;
    }
    var bar = editorBar(start);
    if (bar && (!best || bar.contains(best))) return best && best.tagName === "BUTTON" ? best : bar;
    return best;
  }

  var pressedEl = null;

  function releasePress() {
    if (!pressedEl) return;
    var el = pressedEl;
    pressedEl = null;
    el.classList.remove("is-down");
    if (el.getAttribute("data-vega-press") === "check") {
      el.classList.remove("is-pop");
      void el.offsetWidth;
      el.classList.add("is-pop");
    }
  }

  document.addEventListener("pointerdown", function (event) {
    if (event.button && event.button !== 0) return;
    var el = pressTarget(event.target);
    if (!el) return;
    if (pressedEl && pressedEl !== el) pressedEl.classList.remove("is-down");
    var kind = isCheckShell(el) ? "check" : "button";
    el.setAttribute("data-vega-press", kind);
    el.classList.add("is-down");
    pressedEl = el;
  }, true);

  document.addEventListener("pointerup", releasePress, true);
  document.addEventListener("pointercancel", releasePress, true);

  scrim.addEventListener("click", hideOverlays);

  document.addEventListener("click", function (event) {
    if (event.target === scrim) return;
    if (event.target && event.target.getAttribute && event.target.getAttribute("data-vega-number")) return;
    if (event.target && (event.target.tagName === "SELECT" || event.target.tagName === "OPTION")) return;

    if (isSheetGrabHit(event.target)) {
      hideOverlays();
      return;
    }

    var label = "";
    var node = event.target;
    while (node && node !== document.body) {
      if (node.tagName === "P" || node.tagName === "SPAN") {
        label = normalize(node.textContent);
        if (label) break;
      }
      node = node.parentElement;
    }

    if (isDisStatusHit(event.target) && (label === "Отключить" || label === "Подключен" || label === "Подключено" || label === "Заблокирован" || !label)) {
      if (prosthesisConnected()) disconnectProsthesis();
      return;
    }

    if (label === "Сохранить") {
      if (editingParam) saveParam();
      else hideOverlays();
      return;
    }

    if (label === "Отправить") {
      if (pendingMode) {
        var mode = pendingMode;
        pendingMode = "";
        hideOverlays();
        bleRequest({ cmd: "mode", mode: mode });
        return;
      }
      if (editingSensor) {
        var sensorField = document.querySelector("#vega-stub [data-vega-stub-field]");
        var sensorValue = sensorField ? sensorField.value : "";
        if (!sensorValue) return;
        var sensor = editingSensor;
        editingSensor = "";
        hideOverlays();
        bleRequest({ cmd: "set_k", sensor: Number(sensor), value: Number(sensorValue), k1: bleState.k1, k2: bleState.k2 });
        return;
      }
      saveGripLoad();
      editingParam = null;
      hideOverlays();
      return;
    }

    if (label === "Отмена") {
      editingParam = null;
      pendingMode = "";
      editingSensor = "";
      hideOverlays();
      return;
    }

    if (label === "Вход") {
      submitPassword();
      return;
    }

    if (label === "Выйти из сервисного режима") {
      exitServiceMode();
      return;
    }

    if (label === "Добавить документ" || docCard(event.target)) return;

    var header = headerIconInfo(event.target);
    if (header) {
      if (header.kind === "ble") openProsthesisChooser();
      return;
    }

    if (label === "Добавить профиль протеза" || addProfileCard(event.target)) {
      openDevicePicker();
      return;
    }

    if (label === "Пользовательский режим") {
      confirmMode("user");
      return;
    }

    if (label === "Сервисный режим протеза") {
      confirmMode("service");
      return;
    }

    if (label === "Обновить настройки протеза") {
      bleRequest({ cmd: "read_myo" });
      return;
    }

    if (label === "Сброс настроек") {
      resetParams();
      return;
    }

    var paramRow = serviceParamRow(event.target);
    if (paramRow) {
      openParam(paramRow);
      return;
    }

    var pencil = pencilOf(event.target);
    if (pencil) {
      var sensor = pencilSensor(pencil);
      editingSensor = sensor;
      pendingMode = "";
      openStub(
        "Чувствительность MYO датчика " + sensor,
        "Введите значение параметра MYO-" + sensor,
        "Пример: 0.4",
        "Отправить",
        "Диапазон значений: 0.0 ... 1.0",
        true
      );
      return;
    }

    if (label === "Загрузить схваты") {
      openGripLoad();
      return;
    }

    if (label === "5 сек" || label === "10 сек" || label === "30 сек") {
      selectTime(label);
      return;
    }

    var chip = chipOf(event.target);
    if (chip && (label === "MYO-1" || label === "MYO-2" || label === "АКБ")) {
      if (!chip.dataset.vegaReady) {
        chip.dataset.vegaReady = "1";
        chip.dataset.vegaOff = (chip.getAttribute("style") || "").indexOf("254, 254, 254") !== -1 ? "1" : "0";
      }
      paintChip(chip, chip.dataset.vegaOff === "1");
      return;
    }

    if (label === "Жест Коза" || label === "Жест Джамбо" || label === "Схват Ключа") {
      var activeGrip = document.getElementById("34_230_0_1");
      if (activeGrip) activeGrip.textContent = "Активный схват: " + label;
      return;
    }

    if (devHeaderHit(event.target)) {
      devOpen = !devOpen;
      layoutService();
      return;
    }

    var bar = editorBar(event.target);
    if (bar) {
      var hadMenu = !!bar.querySelector("[data-vega-menu]");
      closeMenus();
      if (!hadMenu) openFingerMenu(bar);
      return;
    }
    closeMenus();

    if (label === "Список устройств") {
      openProsthesisChooser();
      return;
    }

    if (label === "Выбрать") {
      hideOverlays();
      return;
    }

    var file = findRoute(event.target);
    if (file) {
      go(file);
      return;
    }

    if (isUpButton(event.target)) {
      [document.scrollingElement, document.documentElement, document.body].forEach(function (el) {
        if (el && typeof el.scrollTo === "function") el.scrollTo({ top: 0, behavior: "smooth" });
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    if (isDeviceCard(event.target)) {
      openSheet("Информация об устройстве");
    }
  });

  function mountPage() {
    collectSheets();
    initPassword();
    wrapDevChevron();
    ensureExitButton();
    ensureProsthesisModeRow();
    layoutService();
    paintParamValues();
    bindSwitches();
    bindChecks();
    bindDocCards();
    paintAppVersion();
    paintLockedNav();
    fitAdvancedSettingsButton();
    var profileNodes = document.querySelectorAll("#vega-root div");
    for (var profileIndex = 0; profileIndex < profileNodes.length; profileIndex++) {
      if (addProfileCard(profileNodes[profileIndex]) === profileNodes[profileIndex]) profileNodes[profileIndex].style.cursor = "pointer";
    }
    bindHeaderIcons();
    bindTrigger();
    bindPencils();
    bindSettingsRows();
    paintAxis();
    bindGripScroll();
    hideIconBesideNotification();
    ensureUpButton();
    paintLink();
  }

  var pageQuiet = false;
  var screenName = location.pathname.split("/").pop() || "";

  function showPage(file) {
    return fetch(file, { cache: "no-store" }).then(function (response) {
      if (!response.ok) throw new Error("Не удалось открыть экран");
      return response.text();
    }).then(function (html) {
      var parsed = new DOMParser().parseFromString(html, "text/html");
      var blocks = document.head.querySelectorAll("style:not(#vega-page-style)");
      for (var i = 0; i < blocks.length; i++) blocks[i].parentNode.removeChild(blocks[i]);
      var styleHost = document.getElementById("vega-page-style");
      if (!styleHost) {
        styleHost = document.createElement("style");
        styleHost.id = "vega-page-style";
        document.head.appendChild(styleHost);
      }
      var css = "";
      var incoming = parsed.querySelectorAll("style");
      for (var s = 0; s < incoming.length; s++) css += incoming[s].textContent;
      styleHost.textContent = css;
      screenName = file;
      var root = ensureRoot();
      root.innerHTML = "";
      var nodes = parsed.body.childNodes;
      for (var n = 0; n < nodes.length; n++) {
        if (nodes[n].tagName === "SCRIPT") continue;
        root.appendChild(document.importNode(nodes[n], true));
      }
      document.title = parsed.title || document.title;
      document.body.scrollTop = 0;
      mountPage();
    }).catch(function (error) {
      toast(error && error.message ? error.message : "Не удалось открыть экран", 8000);
    });
  }

  window.addEventListener("popstate", function () {
    var name = location.pathname.split("/").pop();
    if (!name || name.indexOf(".html") === -1) return;
    pageQuiet = true;
    showPage(name).then(function () { pageQuiet = false; }, function () { pageQuiet = false; });
  });

  mountPage();
  try {
    var savedBleError = sessionStorage.getItem("vega-ble-error");
    if (savedBleError) {
      sessionStorage.removeItem("vega-ble-error");
      toast(savedBleError, 12000);
    }
  } catch (e) {}
  window.addEventListener("beforeunload", function (event) {
    if (!prosthesisConnected()) return;
    event.preventDefault();
    event.returnValue = "Соединение с протезом может быть потеряно.";
    return event.returnValue;
  });
  bleRequest({ cmd: "hello" });
  function bindGripScroll() {
    var row = document.getElementById("vega-grips");
    if (!row) return;
    var drag = { on: false, x: 0, left: 0, moved: false };
    row.style.cursor = "grab";
    row.addEventListener("pointerdown", function (event) {
      if (event.pointerType && event.pointerType !== "mouse") return;
      if (event.button && event.button !== 0) return;
      drag.on = true;
      drag.moved = false;
      drag.x = event.clientX;
      drag.left = row.scrollLeft;
    });
    row.addEventListener("pointermove", function (event) {
      if (!drag.on) return;
      var dx = event.clientX - drag.x;
      if (Math.abs(dx) > 6) {
        drag.moved = true;
        row.style.cursor = "grabbing";
        if (pressedEl && row.contains(pressedEl)) releasePress();
      }
      if (!drag.moved) return;
      row.scrollLeft = drag.left - dx;
    });
    function endDrag() {
      drag.on = false;
      row.style.cursor = "grab";
    }
    row.addEventListener("pointerup", endDrag);
    row.addEventListener("pointercancel", endDrag);
    row.addEventListener("wheel", function (event) {
      if (row.scrollWidth <= row.clientWidth + 1) return;
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      row.scrollLeft += event.deltaY;
      event.preventDefault();
    }, { passive: false });
    row.addEventListener("click", function (event) {
      if (!drag.moved) return;
      event.stopPropagation();
      event.preventDefault();
      drag.moved = false;
    }, true);
  }
})();
